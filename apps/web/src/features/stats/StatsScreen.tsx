import type { ReactNode } from 'react';
import { ErrorMessage, Loading } from '../shell/states';
import { useStats, type Bar } from './useStats';

function Tile({
  title,
  value,
  suffix,
  caption,
}: {
  title: string;
  value: string;
  suffix?: string;
  caption: string;
}) {
  return (
    <div className="panel flex flex-col gap-3 p-6">
      <h2 className="text-body text-text-secondary">{title}</h2>
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-[40px] leading-none font-semibold tracking-tight">
          {value}
        </span>
        {suffix && <span className="text-section font-normal text-text-secondary">{suffix}</span>}
      </p>
      <p className="text-meta text-text-secondary lg:text-body">{caption}</p>
    </div>
  );
}

function ChartHeader({ id, title, readout }: { id: string; title: string; readout: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-section font-semibold lg:text-[22px]">
        {title}
      </h2>
      <p className="text-body text-text-secondary" aria-live="polite" data-testid={`${id}-readout`}>
        {readout}
      </p>
    </div>
  );
}

function Bars({
  bars,
  onFocusBar,
  height,
  gap,
  children,
  labelledBy,
}: {
  bars: Bar[];
  onFocusBar: (index: number | null) => void;
  height: string;
  gap: string;
  children?: ReactNode;
  labelledBy: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy}>
      <div className={`flex items-end ${gap} border-b border-border ${height}`}>
        {bars.map((bar, i) => (
          <button
            key={i}
            type="button"
            aria-label={bar.label}
            className="flex h-full min-w-0 flex-1 items-end rounded-t-[4px]"
            onMouseEnter={() => {
              onFocusBar(i);
            }}
            onMouseLeave={() => {
              onFocusBar(null);
            }}
            onFocus={() => {
              onFocusBar(i);
            }}
            onBlur={() => {
              onFocusBar(null);
            }}
          >
            <span
              aria-hidden="true"
              className={`block w-full rounded-t-[4px] ${
                bar.height === 0
                  ? 'h-0.5 bg-border'
                  : bar.isToday
                    ? 'bg-accent-emphasis'
                    : 'bg-accent'
              }`}
              style={
                bar.height === 0
                  ? undefined
                  : { height: `${String(Math.max(bar.height * 100, 2))}%` }
              }
            />
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

export function StatsScreen() {
  const vm = useStats();
  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-page font-semibold tracking-tight lg:text-[40px]">Stats</h1>
        <p className="text-body text-text-secondary lg:text-section lg:font-normal">
          Last 30 days, across all decks.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Tile
          title="Remembered on review"
          value={vm.retention.value}
          caption={vm.retention.caption}
        />
        <Tile title="Reviews" value={vm.reviews.value} caption={vm.reviews.caption} />
        <Tile
          title="Days studied"
          value={vm.daysStudied.value}
          suffix={vm.daysStudied.of}
          caption={vm.daysStudied.caption}
        />
      </div>

      <section className="flex flex-col gap-6" aria-labelledby="forecast">
        <ChartHeader id="forecast" title="Coming up · next 7 days" readout={vm.forecast.readout} />
        <Bars
          bars={vm.forecast.bars}
          onFocusBar={vm.focusForecast}
          height="h-60"
          gap="gap-6 lg:gap-12"
          labelledBy="forecast"
        >
          <div className="mt-3 flex gap-6 lg:gap-12" aria-hidden="true">
            {vm.forecast.bars.map((bar, i) => (
              <span key={i} className="flex-1 text-center text-meta text-text-secondary">
                {bar.axis}
              </span>
            ))}
          </div>
        </Bars>
      </section>

      <section className="flex flex-col gap-6" aria-labelledby="per-day">
        <ChartHeader id="per-day" title="Reviews per day" readout={vm.perDay.readout} />
        <Bars
          bars={vm.perDay.bars}
          onFocusBar={vm.focusPerDay}
          height="h-48"
          gap="gap-0.5 lg:gap-1.5"
          labelledBy="per-day"
        >
          <div
            className="mt-3 flex justify-between text-meta text-text-secondary"
            aria-hidden="true"
          >
            {vm.perDay.axis.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </Bars>
      </section>

      <section aria-labelledby="your-cards" className="flex flex-col gap-4">
        <h2 id="your-cards" className="text-section font-semibold lg:text-[22px]">
          Your cards
        </h2>
        <dl className="border-t border-border">
          {vm.cards.map((row) => (
            <div
              key={row.label}
              className="flex min-h-16 items-center justify-between border-b border-border"
            >
              <dt className="text-body lg:text-[17px]">{row.label}</dt>
              <dd className="font-mono text-body lg:text-[17px]">{row.count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
