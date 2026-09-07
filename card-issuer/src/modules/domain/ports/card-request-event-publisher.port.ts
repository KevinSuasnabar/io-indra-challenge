export type CardRequestEventPublisher = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  publish(message: object, key: string, topic: string): Promise<void>;
};
