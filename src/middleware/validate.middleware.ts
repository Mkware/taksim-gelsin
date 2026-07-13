/**
 * Zod Doğrulama Middleware
 * Request body, query veya params'ı Zod şemasına göre doğrular.
 * Hatalı veri gelirse 400 Bad Request döner.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * İstek verisinin hangi bölümünü doğrulayacağımızı belirler
 */
type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Zod şeması ile doğrulama middleware'i
 * @param schema Zod doğrulama şeması
 * @param target Doğrulanacak bölüm (varsayılan: body)
 *
 * Kullanım:
 *   router.post('/login', validate(loginSchema), controller.login);
 *   router.get('/rides', validate(paginationSchema, 'query'), controller.list);
 */
export function validate(schema: ZodSchema, target: ValidationTarget = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Belirtilen bölümü doğrula ve dönüştürülmüş veriyi geri ata
      const validated = schema.parse(req[target]);
      req[target] = validated;
      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        // Zod hata mesajlarını Türkçe ve okunabilir formata çevir
        const errors = error.errors.map((e) => ({
          alan: e.path.join('.'),
          mesaj: e.message,
        }));

        res.status(400).json({
          success: false,
          error: 'Doğrulama hatası. Gönderilen veriler hatalı.',
          details: errors,
        });
        return;
      }

      // Beklenmeyen hata → merkezi errorHandler (tutarlı 500 + loglama)
      next(error);
    }
  };
}
