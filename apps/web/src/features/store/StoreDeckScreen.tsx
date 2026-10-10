import { CARD_TYPES } from '@recall/core';
import { Check, ChevronLeft, KeyRound, Plus, WifiOff } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatCount } from '../../services/format';
import { Dialog } from '../../ui/Dialog';
import { ErrorMessage, Loading, NotFound } from '../shell/states';
import { SampleCard } from './SampleCard';
import { formatPrice, subjectCodeLabel, TYPE_NAMES } from './storeView';
import { OFFLINE_ADD_MESSAGE, useStoreDeck, type StoreDeckViewModel } from './useStoreDeck';

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A deck's store page (BUILD_BRIEF_M6_M8 §7.7; UI plan in M7_M8_REPORT.md). */
export function StoreDeckScreen() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const branch = params.get('branch');
  const vm = useStoreDeck(slug);

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error')
    return <ErrorMessage message="Couldn’t load this deck. Please try again." />;
  if (vm.status === 'notFound' || !vm.deck)
    return <NotFound message="This deck isn’t in the store." />;
  const { deck } = vm;
  const code = subjectCodeLabel(deck.catalog.subjectCodes, branch);
  const canAdd = !vm.paid || vm.owned;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link to="/store" className="link -ml-1 inline-flex items-center gap-1 self-start">
          <ChevronLeft aria-hidden="true" className="size-5" />
          Store
        </Link>
        <h1 className="text-page font-semibold tracking-tight">{deck.catalog.subject}</h1>
        {deck.title !== deck.catalog.subject && (
          <p className="text-section font-normal text-text-secondary">{deck.title}</p>
        )}
      </header>

      <section aria-label="Add" className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-section font-semibold">
          {vm.paid && vm.owned ? (
            <>
              <Check aria-hidden="true" className="size-5 text-success" />
              Owned
            </>
          ) : (
            formatPrice(deck.price)
          )}
        </p>
        {canAdd ? (
          <>
            <button
              type="button"
              className="btn-primary min-h-14 self-stretch text-section lg:self-start"
              disabled={vm.adding || vm.offline}
              onClick={vm.add}
              aria-describedby={vm.offline ? 'add-offline' : undefined}
            >
              <Plus aria-hidden="true" className="size-5" />
              Add to my decks
            </button>
            {vm.inMyDecks && (
              <p className="text-body text-text-secondary">This deck is in your decks.</p>
            )}
          </>
        ) : (
          <a href="#unlock" className="link self-start">
            How to buy, and unlock with a code
          </a>
        )}
        {vm.offline && (
          <p
            id="add-offline"
            role="status"
            className="flex items-center gap-2 text-body text-text-secondary"
          >
            <WifiOff aria-hidden="true" className="size-5 shrink-0" />
            {OFFLINE_ADD_MESSAGE}
          </p>
        )}
        {vm.addError && !vm.offline && (
          <p role="alert" className="text-error">
            {vm.addError}
          </p>
        )}
      </section>

      <section aria-labelledby="about-title" className="flex flex-col gap-4">
        <h2 id="about-title" className="text-section font-semibold">
          About
        </h2>
        <p className="text-body whitespace-pre-wrap text-text-secondary lg:text-section lg:font-normal">
          {deck.description}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-text-secondary">University</dt>
          <dd>{deck.catalog.university}</dd>
          <dt className="text-text-secondary">Pattern</dt>
          <dd>{deck.catalog.pattern} pattern</dd>
          <dt className="text-text-secondary">Year</dt>
          <dd>
            {deck.catalog.year} · Semester {deck.catalog.semester}
          </dd>
          <dt className="text-text-secondary">Branches</dt>
          <dd>{deck.catalog.branches.join(', ')}</dd>
          {code !== null && (
            <>
              <dt className="text-text-secondary">Subject code</dt>
              <dd className="font-mono">{code}</dd>
            </>
          )}
          <dt className="text-text-secondary">Author</dt>
          <dd>
            {deck.author}
            {deck.reviewedBy && <> · reviewed by {deck.reviewedBy}</>}
          </dd>
          <dt className="text-text-secondary">Last checked</dt>
          <dd>{dateFormat.format(new Date(`${deck.lastVerifiedAt}T00:00:00Z`))}</dd>
        </dl>
      </section>

      <section aria-labelledby="units-title" className="flex flex-col gap-3">
        <h2 id="units-title" className="text-section font-semibold">
          Units
        </h2>
        <ul className="border-t border-border">
          {deck.units.map((u) => (
            <li
              key={u.number}
              className="flex items-baseline gap-4 border-b border-border py-3 text-body"
            >
              <span className="w-16 shrink-0 text-text-secondary">Unit {u.number}</span>
              <span className="flex-1">{u.title}</span>
              <span className="font-mono text-text-secondary">{formatCount(u.cardCount)}</span>
            </li>
          ))}
        </ul>
        <p className="text-body text-text-secondary">
          <span className="font-mono">{formatCount(deck.cardCount)}</span> cards:{' '}
          {CARD_TYPES.filter((t) => deck.typeCounts[t] > 0)
            .map((t) => `${TYPE_NAMES[t]} ${formatCount(deck.typeCounts[t])}`)
            .join(' · ')}
        </p>
      </section>

      <section aria-labelledby="samples-title" className="flex flex-col gap-4">
        <h2 id="samples-title" className="text-section font-semibold">
          Sample cards
        </h2>
        {vm.samples === null ? (
          <p className="flex items-center gap-2 text-body text-text-secondary">
            <WifiOff aria-hidden="true" className="size-5 shrink-0" />
            Connect to the internet to see sample cards.
          </p>
        ) : (
          <>
            <p className="text-body text-text-secondary">
              Try them: answer, check and reveal. Nothing is recorded.
            </p>
            {vm.samples.map((card, i) => (
              <SampleCard key={card.key} card={card} label={`Sample card ${String(i + 1)}`} />
            ))}
          </>
        )}
      </section>

      {vm.paid && !vm.owned && <Unlock vm={vm} slug={deck.slug} price={formatPrice(deck.price)} />}

      <Dialog
        open={vm.confirming}
        onClose={vm.keepOneCopy}
        title={`Add ${deck.catalog.subject} again?`}
        testId="duplicate-warning"
      >
        <p className="text-body text-text-secondary lg:text-section lg:font-normal">
          You already have this deck. Adding it again makes a second copy that starts from scratch.
          Your progress on the first copy isn’t touched.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="btn-secondary min-h-14 text-section"
            onClick={vm.addSecondCopy}
          >
            Add a second copy
          </button>
          <button
            type="button"
            className="btn-primary min-h-14 text-section"
            onClick={vm.keepOneCopy}
            data-autofocus
          >
            Keep one copy
          </button>
        </div>
      </Dialog>
    </div>
  );
}

/** A paid deck's purchase section (§8.4): price, How to buy, and "Have a code?". */
function Unlock({ vm, slug, price }: { vm: StoreDeckViewModel; slug: string; price: string }) {
  return (
    <section id="unlock" aria-labelledby="unlock-title" className="flex flex-col gap-4">
      <h2 id="unlock-title" className="text-section font-semibold">
        Unlock this deck · {price}
      </h2>
      <div className="flex flex-col gap-2">
        <h3 className="text-body font-medium">How to buy</h3>
        {vm.purchaseInfo === null ? (
          <p className="text-body text-text-secondary">
            Connect to the internet to see how to buy this deck.
          </p>
        ) : (
          <p
            data-testid="purchase-info"
            className="text-body whitespace-pre-line text-text-secondary"
          >
            {vm.purchaseInfo}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-body font-medium">Have a code?</h3>
        {vm.signedIn ? (
          <form
            className="flex flex-col gap-2 lg:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              vm.redeem();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">Unlock code</span>
              <input
                type="text"
                className="field font-mono uppercase"
                placeholder="ACE-XXXX-XXXX-XX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={vm.code}
                aria-invalid={vm.redeemError !== null}
                aria-describedby={vm.redeemError ? 'redeem-error' : undefined}
                onChange={(e) => {
                  vm.setCode(e.target.value);
                }}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={vm.redeeming || vm.offline}>
              <KeyRound aria-hidden="true" className="size-5" />
              Redeem
            </button>
          </form>
        ) : (
          <Link
            to={`/signin?next=${encodeURIComponent(`/store/${slug}`)}`}
            className="btn-secondary self-start"
          >
            Sign in to unlock
          </Link>
        )}
        {vm.redeemError && (
          <p id="redeem-error" role="alert" className="text-error">
            {vm.redeemError}
          </p>
        )}
      </div>
    </section>
  );
}
