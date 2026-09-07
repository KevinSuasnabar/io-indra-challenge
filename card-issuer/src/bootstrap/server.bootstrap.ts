import express from 'express';
import http from 'http';
import envs from '../config/environment-vars';
import { Logger } from '../logger';
import { ReturnType, TBootstrap } from './bootstrap.type';

export class ServerBootstrap implements TBootstrap {
  private readonly app: express.Application;
  private readonly logger?: Logger;
  private server?: http.Server;

  constructor(app: express.Application, logger?: Logger) {
    this.app = app;
    this.logger = logger;
  }

  initialize(): ReturnType {
    return new Promise((resolve, reject) => {
      const server = http.createServer(this.app);
      this.server = server;

      const port = envs.port;
      server
        .listen(port)
        .on('listening', () => {
          this.logger?.info(`card-issuer listening on port ${port}`);
          resolve(true);
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}
