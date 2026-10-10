import {
  CARD_TYPES,
  cardContentOf,
  contentHash,
  deckWarnings,
  validateDeckFile,
  type DeckFile,
  type DeckFileCard,
} from '@recall/core';
import type { Prisma } from '../db';
import {
  getVersion,
  latestVersionOf,
  listAll,
  publishVersion,
  PublishError,
  unlistDeck,
} from './store';

// The owner's publishing CLI (BUILD_BRIEF_M6_M8 §7.4): `pnpm deck validate | publish |
// list | unlist`. I/O is injected so the tests run it against the test database.

export interface CliIO {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Asks a yes/no question; true = yes. */
  confirm: (question: string) => Promise<boolean>;
  /** Reads a file given on the command line (throws if it can't). */
  readFile: (path: string) => string;
  /** The database, opened only by commands that need it. */
  prisma: () => Prisma;
  /** Where the database is, e.g. "ep-bold-feather….neon.tech/neondb", for the confirmation. */
  target: string;
}

const USAGE = `Usage: pnpm deck <command>
  validate <file>                       check a deck file; print a summary and warnings
  publish <file> [--unlisted] [--yes]   publish it as the next version (asks first)
  list                                  every deck: slug, version, status, price, cards
  unlist <slug>                         hide a deck from the store (students keep it)`;

const MAX_LINE = 90;
const cards = (n: number) => `${String(n)} ${n === 1 ? 'card' : 'cards'}`;

export function formatPrice(paise: number): string {
  if (paise === 0) return 'Free';
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2)}`;
}

/** The question or prompt of a card, on one line. */
function promptOf(card: DeckFileCard): string {
  const c = cardContentOf(card);
  const text = c.type === 'basic' ? c.front : c.type === 'cloze' ? c.text : c.question;
  return text.replace(/\s+/g, ' ').trim();
}

function line(prefix: string, card: DeckFileCard): string {
  const head = `  ${prefix} ${card.key}  `;
  const room = MAX_LINE - head.length;
  const text = promptOf(card);
  return head + (text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text);
}

function load(path: string, io: CliIO): DeckFile | null {
  let raw: string;
  try {
    raw = io.readFile(path);
  } catch (error) {
    io.err(`Can’t read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    io.err(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const result = validateDeckFile(json);
  if (!result.ok) {
    io.err(`${path} has ${String(result.errors.length)} error(s):`);
    for (const e of result.errors) io.err(`  ✗ ${e}`);
    return null;
  }
  return result.deck;
}

function printSummary(deck: DeckFile, io: CliIO): void {
  io.out(`${deck.slug} v${String(deck.version)} — ${deck.title} (${formatPrice(deck.price)})`);
  io.out(cards(deck.cards.length));
  for (const unit of deck.catalog.units) {
    const n = deck.cards.filter((c) => c.unit === unit.number).length;
    io.out(
      `  Unit ${String(unit.number)} (${unit.title}): ${String(n)} ${n === 1 ? 'card' : 'cards'}`,
    );
  }
  io.out(
    `  Types: ${CARD_TYPES.map((t) => `${t}: ${String(deck.cards.filter((c) => c.type === t).length)}`).join(', ')}`,
  );
  const warnings = deckWarnings(deck);
  if (warnings.length === 0) {
    io.out('No warnings.');
  } else {
    io.out(`Warnings (${String(warnings.length)}):`);
    for (const w of warnings) io.out(`  ! ${w.message}`);
  }
}

function printDiff(previous: DeckFile, next: DeckFile, io: CliIO): void {
  const before = new Map(previous.cards.map((c) => [c.key, c]));
  const after = new Set(next.cards.map((c) => c.key));
  const added = next.cards.filter((c) => !before.has(c.key));
  const changed = next.cards.filter((c) => {
    const old = before.get(c.key);
    return (
      old !== undefined &&
      (contentHash(cardContentOf(old)) !== contentHash(cardContentOf(c)) || old.unit !== c.unit)
    );
  });
  const removed = previous.cards.filter((c) => !after.has(c.key));
  io.out(`v${String(previous.version)} → v${String(next.version)}`);
  if (added.length + changed.length + removed.length === 0) io.out('No card changes.');
  const section = (title: string, prefix: string, cards: DeckFileCard[]) => {
    if (cards.length === 0) return;
    io.out(`${title} (${String(cards.length)}):`);
    for (const c of cards) io.out(line(prefix, c));
  };
  section('Added', '+', added);
  section('Changed', '~', changed);
  section('Removed', '-', removed);
}

async function publish(args: string[], io: CliIO): Promise<number> {
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    io.err(USAGE);
    return 2;
  }
  const deck = load(path, io);
  if (!deck) return 1;
  const prisma = io.prisma();
  const latest = await latestVersionOf(prisma, deck.slug);
  const expected = latest === null ? 1 : latest + 1;
  if (deck.version !== expected) {
    io.err(
      latest === null
        ? `version must be 1 (a new deck), got ${String(deck.version)}`
        : `version must be ${String(expected)} (the latest is ${String(latest)}), got ${String(deck.version)}`,
    );
    return 1;
  }
  printSummary(deck, io);
  const previous = latest === null ? null : await getVersion(prisma, deck.slug, latest);
  if (previous) printDiff(previous, deck, io);
  else io.out(`New deck ${deck.slug}: ${cards(deck.cards.length)}`);

  const unlisted = args.includes('--unlisted');
  if (!args.includes('--yes')) {
    const ok = await io.confirm(
      `Publish ${deck.slug} v${String(deck.version)}${unlisted ? ' (unlisted)' : ''} to ${io.target}?`,
    );
    if (!ok) {
      io.out('Not published.');
      return 1;
    }
  }
  try {
    await publishVersion(prisma, deck, { unlisted });
  } catch (error) {
    if (error instanceof PublishError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  io.out(`Published ${deck.slug} v${String(deck.version)}${unlisted ? ' (unlisted)' : ''}.`);
  return 0;
}

/** Runs one CLI command; returns the process exit code. */
export async function runDeckCli(argv: string[], io: CliIO): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'validate': {
      const path = args[0];
      if (!path) {
        io.err(USAGE);
        return 2;
      }
      const deck = load(path, io);
      if (!deck) return 1;
      printSummary(deck, io);
      return 0;
    }
    case 'publish':
      return publish(args, io);
    case 'list': {
      const rows = await listAll(io.prisma());
      if (rows.length === 0) io.out('No decks yet.');
      const width = Math.max(0, ...rows.map((r) => r.slug.length));
      for (const r of rows) {
        io.out(
          `${r.slug.padEnd(width)}  v${String(r.version)}  ${r.status.padEnd(9)}  ${formatPrice(r.price).padEnd(7)}  ${cards(r.cardCount)}`,
        );
      }
      return 0;
    }
    case 'unlist': {
      const slug = args[0];
      if (!slug) {
        io.err(USAGE);
        return 2;
      }
      if (!(await unlistDeck(io.prisma(), slug))) {
        io.err(`No deck ${slug}.`);
        return 1;
      }
      io.out(`${slug} is now unlisted. Students who added it keep their copies and updates.`);
      return 0;
    }
    default:
      io.err(USAGE);
      return 2;
  }
}
