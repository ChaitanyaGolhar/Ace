import { Link } from 'react-router';
import { ErrorMessage, Loading } from '../shell/states';
import { useHome } from './useHome';

export function HomeScreen() {
  const vm = useHome();

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;

  return (
    <section aria-labelledby="home-title" className="flex flex-col gap-6">
      <h1 id="home-title" className="text-2xl font-bold">
        Today
      </h1>

      {vm.isEmpty ? (
        <div data-testid="home-empty" className="flex flex-col gap-3">
          <p>Start with a ready-made deck or create your own.</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/decks/new" className="btn">
              Create a deck
            </Link>
          </div>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center" aria-label="Today’s cards">
            <div>
              <dt>Due</dt>
              <dd className="text-3xl" data-testid="count-due">
                {vm.counts.due}
              </dd>
            </div>
            <div>
              <dt>New</dt>
              <dd className="text-3xl" data-testid="count-new">
                {vm.counts.new}
              </dd>
            </div>
            <div>
              <dt>Learning</dt>
              <dd className="text-3xl" data-testid="count-learning">
                {vm.counts.learning}
              </dd>
            </div>
          </dl>

          {vm.canStudy ? (
            <Link to="/study" className="btn text-lg">
              Study now
            </Link>
          ) : (
            <p>Nothing to study right now.</p>
          )}

          <section aria-labelledby="decks-title" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="decks-title" className="text-xl font-bold">
                Decks
              </h2>
              <Link to="/decks/new" className="btn">
                Create a deck
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {vm.decks.map((deck) => (
                <li key={deck.id}>
                  <Link
                    to={`/decks/${deck.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
                  >
                    <span>{deck.name}</span>
                    <span>
                      {deck.counts.due + deck.counts.learning} due · {deck.counts.new} new
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
