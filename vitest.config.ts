import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Testcontainers ile paralel testler aynı anda birden fazla Postgres/Redis
    // konteyneri ayağa kaldırır — CI runner'ında ve yerelde kaynak/istikrar için
    // tek worker'da sırayla çalıştırıyoruz.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
