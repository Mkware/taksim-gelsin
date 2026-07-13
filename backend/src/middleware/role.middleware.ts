/**
 * Rol Bazlı Yetkilendirme Middleware
 * Belirli endpoint'lere sadece belirli rollerin erişmesini sağlar.
 * authMiddleware'den sonra çalıştırılmalıdır.
 */

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';

/**
 * Belirtilen rollere sahip kullanıcıların erişimine izin verir
 * @param allowedRoles İzin verilen roller dizisi (örn: ['driver'] veya ['customer', 'driver'])
 *
 * Kullanım:
 *   router.get('/earnings', authMiddleware, roleMiddleware(['driver']), controller.getEarnings);
 */
export function roleMiddleware(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // authMiddleware çalışmamışsa veya kullanıcı bilgisi yoksa
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Kimlik doğrulama gerekli.',
      });
      return;
    }

    // Kullanıcının rolü izin verilen roller arasında mı?
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Bu işlem için yetkiniz yok. Gerekli rol: ${allowedRoles.join(' veya ')}`,
      });
      return;
    }

    next();
  };
}
