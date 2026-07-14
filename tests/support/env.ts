/**
 * src/config/env.ts, process.env'i modül yüklenme anında Zod ile doğrular ve
 * eksik/geçersizse process.exit(1) çağırır. Testlerde app modüllerini
 * (örn. smart_matching.service.ts) import etmeden önce şemayı geçecek
 * sahte-ama-geçerli değerler set edilmeli. Supabase'e gerçekten bağlanılmıyor
 * (yalnızca Redis'e dokunan kod yolları test ediliyor), bu yüzden URL/anahtarlar
 * sözdizimsel olarak geçerli olması yeterli.
 *
 * ÖNEMLİ: env.ts'in loadDotenv()'i, backend/.env varsa (yerel geliştirmede hep
 * vardır) onu dotenv.config() ile yükler — ki bu SADECE process.env'de henüz
 * olmayan anahtarları set eder. REDIS_TLS/REDIS_PASSWORD gibi burada set
 * etmediğimiz alanlar gerçek .env'den (ör. gerçek Upstash TLS kimlik bilgileri)
 * sızıp test container'ına karşı TLS handshake denemesine yol açabilir — bu
 * yüzden Redis'e dair HER alan burada açıkça set ediliyor.
 */
export function setDummyAppEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: '',
    REDIS_DB: '0',
    REDIS_TLS: 'false',
    ...overrides,
  });
}
