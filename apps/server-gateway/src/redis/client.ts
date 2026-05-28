import Redis from 'ioredis';

export type RedisClient = Redis;

export function createRedis(connectionString: string): RedisClient {
  return new Redis(connectionString, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
}
