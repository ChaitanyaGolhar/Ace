import { ErrorMessage, Loading } from '../shell/states';
import { useSessionComplete } from './useSessionComplete';

export function SessionCompleteScreen() {
  const vm = useSessionComplete();

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;

  return (
    <section aria-labelledby="complete-title" className="flex flex-col gap-4">
      <h1 id="complete-title" className="text-2xl font-bold">
        Session complete
      </h1>
      {vm.hasSummary && (
        <dl className="grid grid-cols-2 gap-2">
          <dt>Cards reviewed</dt>
          <dd data-testid="reviewed-count">{vm.reviewed}</dd>
          <dt>Time spent</dt>
          <dd data-testid="time-spent">{vm.timeSpent}</dd>
        </dl>
      )}
      <p data-testid="next-due">{vm.nextDue}</p>
      <button type="button" className="btn" onClick={vm.backToHome}>
        Back to Home
      </button>
    </section>
  );
}
