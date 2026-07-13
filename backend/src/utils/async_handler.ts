/**
 * Express async route/middleware sarmalayıcısı.
 *
 * Express 4, async handler'lardan dönen reddedilmiş promise'leri otomatik yakalamaz.
 * Bu sarmalayıcı, fırlatılan/redde uğrayan hataları `next(err)` ile merkezi errorHandler'a
 * iletir. (Genel güvenlik ağı olarak app.ts'te yerel `patch_async_errors` yaması yüklüdür; bu
 * yardımcı, açıkça sarmalanmak istenen handler'lar için kullanılabilir.)
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
