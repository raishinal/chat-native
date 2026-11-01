/** Passive incoming-call updates must never trigger a setup dialog. */
export class NativeCallSetup {
  private initialization: Promise<boolean> | undefined;
  private initialize: () => Promise<void>;
  private enabled: () => Promise<boolean>;
  private prompt: () => Promise<unknown>;

  constructor(
    initialize: () => Promise<void>,
    enabled: () => Promise<boolean>,
    prompt: () => Promise<unknown>,
  ) {
    this.initialize = initialize;
    this.enabled = enabled;
    this.prompt = prompt;
  }

  async ready() {
    this.initialization ??= this.initialize()
      .then(() => true)
      .catch(() => false);
    if (!(await this.initialization)) return false;
    return this.enabled();
  }

  async request() {
    try {
      await this.ready();
      await this.prompt();
      return this.ready();
    } catch {
      // Later/Cancel is a completed user choice, not an initialization failure.
      return false;
    }
  }
}
