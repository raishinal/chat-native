import type { User } from "./contracts.ts";
type Storage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
};
/** Generation checks prevent an old restoration from reviving a logged-out session. */
export class SessionState {
  private generation = 0;
  private storage: Storage;
  private install: (token: string, user: User | null) => void;
  constructor(
    storage: Storage,
    install: (token: string, user: User | null) => void,
  ) {
    this.storage = storage;
    this.install = install;
  }
  async restore(validate: (token: string) => Promise<User>) {
    const generation = ++this.generation;
    const token = await this.storage.read();
    if (!token || generation !== this.generation) return;
    try {
      const user = await validate(token);
      if (user.status !== "active")
        throw Object.assign(new Error("Account is not active."), {
          status: 403,
        });
      if (generation === this.generation) this.install(token, user);
    } catch (e) {
      if (
        generation === this.generation &&
        [401, 403].includes((e as { status: number }).status)
      )
        await this.clear();
      throw e;
    }
  }
  async login(token: string, user: User) {
    if (user.status !== "active")
      throw new Error("This account is not active.");
    const generation = ++this.generation;
    await this.storage.write(token);
    if (generation === this.generation) this.install(token, user);
  }
  async clear() {
    ++this.generation;
    this.install("", null);
    await this.storage.clear();
  }
}
