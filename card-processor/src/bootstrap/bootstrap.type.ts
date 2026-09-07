export type ReturnType = Promise<boolean>;

export interface TBootstrap {
  initialize(): ReturnType;
  close?(): void;
}
