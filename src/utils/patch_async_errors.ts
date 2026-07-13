/**
 * Express 4 async-hata yaması (bağımlılıksız, yerel sürüm).
 *
 * Express 4, async route/middleware handler'larından dönen reddedilmiş promise'leri
 * otomatik yakalamaz; try/catch unutulursa hata `unhandledRejection`'a düşer. Bu yama
 * Router Layer.handle'ı sararak böyle hataları otomatik `next(err)` ile merkezi
 * errorHandler'a iletir.
 *
 * NEDEN harici `express-async-errors` paketi yerine bu?
 *   - Üretim sunucusunda paket kurulu olmazsa süreç MODULE_NOT_FOUND ile çökerdi.
 *   - Bu yama yalnızca zaten var olan `express`'i kullanır; ekstra kurulum gerektirmez.
 *   - İç express yolu bir sürümde değişirse try/catch sessizce devre dışı bırakır;
 *     başlatma ASLA çökmez (route'lardaki try/catch zaten birincil korumadır).
 */

import { logger } from './logger';

type Handler = (...args: any[]) => any;

function applyPatch(): void {
  // Kasıtlı dinamik require: express'in iç yolu bir sürümde değişirse/kaybolursa
  // hata burada, applyPatch() içindeki try/catch tarafından yakalanabilsin diye
  // (üstteki statik import'lar modül yüklenirken çalışır, bu try/catch'i atlar).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Layer = require('express/lib/router/layer');

  if (!Layer?.prototype) {
    throw new Error('express Layer prototype bulunamadı');
  }

  // Zaten yamalanmışsa tekrar etme
  if ((Layer as { __asyncPatched?: boolean }).__asyncPatched) return;

  const last = (arr: any[] = []): any => arr[arr.length - 1];
  const noop = (): void => {};

  function wrap(fn: Handler): Handler {
    const wrapped = function wrapped(this: unknown, ...args: any[]): any {
      const ret = fn.apply(this, args);
      // 4 argümanlı (err, req, res, next) => next = args[3]; aksi halde son argüman.
      const next: Handler = (args.length === 5 ? args[2] : last(args)) || noop;
      if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
        (ret as Promise<unknown>).catch((err: unknown) => next(err));
      }
      return ret;
    };
    // KRİTİK: Express, error-handling middleware'i `fn.length === 4` ile ayırt eder.
    // `...args` arity'yi 0 yaptığı için orijinal arity'yi geri yazmazsak hata
    // handler'ları normal middleware sanılıp atlanır. name'i de korumak debug'ı kolaylaştırır.
    Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true });
    Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });

    // Orijinal handler'ın enumerable özelliklerini koru (Express bazı meta alanlara bakar)
    const src = fn as unknown as Record<string, unknown>;
    const dst = wrapped as unknown as Record<string, unknown>;
    Object.keys(src).forEach((key) => {
      dst[key] = src[key];
    });
    return wrapped;
  }

  Object.defineProperty(Layer.prototype, 'handle', {
    configurable: true,
    enumerable: true,
    get(): Handler | undefined {
      return (this as { __handle?: Handler }).__handle;
    },
    set(fn: Handler) {
      (this as { __handle?: Handler }).__handle = typeof fn === 'function' ? wrap(fn) : fn;
    },
  });

  (Layer as { __asyncPatched?: boolean }).__asyncPatched = true;
}

try {
  applyPatch();
  logger.info('[async-errors] Express async hata yaması uygulandı.');
} catch (e) {
  logger.warn(
    '[async-errors] Express async hata yaması uygulanamadı (route try/catch birincil koruma):',
    e,
  );
}
