export type SchedulerLogger = Pick<Console, 'error'>;

export function startScheduledJob(
  runJob: () => Promise<void>,
  intervalMs: number,
  logger: SchedulerLogger = console,
): () => void {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('intervalMs must be a positive safe integer.');
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const scheduleNextRun = () => {
    if (!stopped) timer = setTimeout(executeScheduledRun, intervalMs);
  };
  const executeScheduledRun = async () => {
    try {
      await runJob();
    } catch (error) {
      logger.error('Scheduled fuel data fetch failed:', error);
    } finally {
      scheduleNextRun();
    }
  };

  void executeScheduledRun();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}