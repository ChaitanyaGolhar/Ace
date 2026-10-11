import { z } from 'zod';
import { Uuid } from './schemas';

// Product events (brief M4): an append-only log of what happened, for retention
// analytics. Synced like review logs. Payloads can never carry card text: every props
// object is strict (unknown keys are rejected) and holds only numbers, booleans, enums
// or a deck slug.

const count = z.int().nonnegative();
const slug = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const EVENT_PROPS = {
  app_opened: z.strictObject({}),
  first_review_completed: z.strictObject({}),
  /** `due` = review + learning cards due when the session started; `new` = new cards allowed. */
  session_started: z.strictObject({ scope: z.enum(['all', 'deck']), due: count, new: count }),
  session_completed: z.strictObject({ reviewed: count, durationMs: count }),
  /** Left with at least one card remaining. */
  session_abandoned: z.strictObject({ reviewed: count, remaining: z.int().min(1) }),
  deck_added_prebuilt: z.strictObject({ prebuiltId: slug }),
  card_created: z.strictObject({}),
  signed_in: z.strictObject({}),
  // M7 (BUILD_BRIEF_M6_M8 §7.8): the store.
  store_opened: z.strictObject({}),
  catalog_deck_viewed: z.strictObject({ slug }),
  catalog_deck_added: z.strictObject({ slug, version: z.int().min(1) }),
  deck_update_applied: z.strictObject({ slug, from: z.int().min(1), to: z.int().min(1) }),
  // M8 (BUILD_BRIEF_M6_M8 §8.5): paid decks. Never the code itself.
  purchase_info_viewed: z.strictObject({ slug }),
  code_redeemed: z.strictObject({ slugs: z.array(slug).min(1).max(20) }),
  code_redeem_failed: z.strictObject({
    reason: z.enum(['invalid', 'used_up', 'expired', 'rate_limited', 'network', 'other']),
  }),
  // Feel pass: coming back after a break. `due` = review + learning cards due;
  // `daysAway` = study days since the last review.
  break_return_shown: z.strictObject({ due: count, daysAway: count }),
  /** A session limited to the `cap` most overdue cards (of `due`). */
  capped_session_started: z.strictObject({ cap: z.int().min(1), due: count }),
} as const;

export type EventType = keyof typeof EVENT_PROPS;
export const EVENT_TYPES = Object.keys(EVENT_PROPS) as EventType[];

/**
 * The event catalogue's version. An app parses pulled events strictly, so a type it
 * doesn't know would fail its whole pull: pulls declare the version they understand
 * and only get those types (DECISIONS D-348). Bump it with every new type.
 * - 1: up to M8 (what apps that send no version know).
 * - 2: break_return_shown, capped_session_started.
 */
export const EVENTS_VERSION = 2;
const ADDED_IN: Partial<Record<EventType, number>> = {
  break_return_shown: 2,
  capped_session_started: 2,
};

/** The event types an app that understands catalogue `version` can parse. */
export function eventTypesFor(version: number): EventType[] {
  return EVENT_TYPES.filter((type) => (ADDED_IN[type] ?? 1) <= version);
}

const base = {
  id: Uuid,
  /** Epoch ms, device clock. */
  occurredAt: z.int().nonnegative(),
  deviceId: z.string().min(1).max(100),
};

export const EventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('app_opened'), props: EVENT_PROPS.app_opened }),
  z.object({
    ...base,
    type: z.literal('first_review_completed'),
    props: EVENT_PROPS.first_review_completed,
  }),
  z.object({ ...base, type: z.literal('session_started'), props: EVENT_PROPS.session_started }),
  z.object({ ...base, type: z.literal('session_completed'), props: EVENT_PROPS.session_completed }),
  z.object({ ...base, type: z.literal('session_abandoned'), props: EVENT_PROPS.session_abandoned }),
  z.object({
    ...base,
    type: z.literal('deck_added_prebuilt'),
    props: EVENT_PROPS.deck_added_prebuilt,
  }),
  z.object({ ...base, type: z.literal('card_created'), props: EVENT_PROPS.card_created }),
  z.object({ ...base, type: z.literal('signed_in'), props: EVENT_PROPS.signed_in }),
  z.object({ ...base, type: z.literal('store_opened'), props: EVENT_PROPS.store_opened }),
  z.object({
    ...base,
    type: z.literal('catalog_deck_viewed'),
    props: EVENT_PROPS.catalog_deck_viewed,
  }),
  z.object({
    ...base,
    type: z.literal('catalog_deck_added'),
    props: EVENT_PROPS.catalog_deck_added,
  }),
  z.object({
    ...base,
    type: z.literal('deck_update_applied'),
    props: EVENT_PROPS.deck_update_applied,
  }),
  z.object({
    ...base,
    type: z.literal('purchase_info_viewed'),
    props: EVENT_PROPS.purchase_info_viewed,
  }),
  z.object({ ...base, type: z.literal('code_redeemed'), props: EVENT_PROPS.code_redeemed }),
  z.object({
    ...base,
    type: z.literal('code_redeem_failed'),
    props: EVENT_PROPS.code_redeem_failed,
  }),
  z.object({
    ...base,
    type: z.literal('break_return_shown'),
    props: EVENT_PROPS.break_return_shown,
  }),
  z.object({
    ...base,
    type: z.literal('capped_session_started'),
    props: EVENT_PROPS.capped_session_started,
  }),
]);

export type AppEvent = z.infer<typeof EventSchema>;
export type EventProps<T extends EventType> = z.infer<(typeof EVENT_PROPS)[T]>;
