/// Türkiye odaklı yasal metin şablonları (KVKK, gizlilik, kullanım).
/// Mağaza (App Store / Play) ve KVKK uyumu için içerik hukuk danışmanlığıyla güncellenmelidir.
class LegalTextsTr {
  LegalTextsTr._();

  static const String lastUpdatedTr = 'Son güncelleme: 11 Mayıs 2026';

  static const String disclaimerFooter = '''

—
Bu metinler bilgilendirme amaçlıdır; işletmenizin unvanı, adresi ve veri işleme
detayları için hukuk danışmanınızla şekillendirin. Kişisel verilerinize ilişkin
taleplerinizi aşağıdaki iletişim kanalından iletebilirsiniz.
''';

  static const String contactEmailPlaceholder = 'destek@taksimgelsin.example';

  /// 6698 sayılı KVKK kapsamında aydınlatma özeti
  static const String kvkkClarification = '''
1. Veri sorumlusu
“Taksim Gelsin” markası altında sunulan taksi eşleştirme mobil uygulaması
kapsamında kişisel verileriniz, hizmeti sağlayan veri sorumlusu sıfatıyla
işlenmektedir. Unvan, adres ve MERSİS vb. ticari bilgiler işletmenizin tescilli
bilgileriyle güncellenmelidir.

2. İşlenen kişisel veriler
Kimlik ve iletişim: ad-soyad, telefon numarası; hesap güvenliği için şifre
(hashed saklama esasına uygun).
Konum ve yolculuk: biniş/varış koordinatları veya adres metinleri, tahmini
ücret ve yolculuk durumu.
Cihaz ve oturum: uygulama sürümü, güvenli oturum için teknik kayıtlar (ör. token).
Ödeme/ticari ileti (varsa): yalnızca hizmetin gerektirdiği ölçüde.
Rol ve sürücü bilgileri: yolcu hesabı uygulama üzerinden açılabilir; sürücü
rolü ve buna bağlı veriler (ör. araç/plaka, operasyonel iletişim) yalnızca veri
sorumlusunun yetkili süreçleriyle (sözleşme, onay, kayıt) tanımlanır. Uygulama
içinde herkese açık bir “sürücü kaydı” akışı bulunmaz.

3. Kişisel verilerin işlenme amaçları
Yolculuk talebinin oluşturulması ve sürücü-yolcu eşleştirmesi; güvenlik ve
dolandırıcılığın önlenmesi; yasal yükümlülüklerin yerine getirilmesi;
müşteri destek süreçleri; anonim istatistik ve hizmet iyileştirmesi;
sürücü hesaplarının yetkili kanallarla yönetimi ve operasyonel uygunluk.

4. Hukuki sebepler
KVKK m.5/2 ve m.6 kapsamında; sözleşmenin kurulması/ifası, meşru menfaat,
açık rıza (ticari ileti veya özel nitelikli veri gerektiğinde), hukuki
yükümlülük.

5. Aktarım
Verileriniz; bulut/altyapı sağlayıcıları ve teknik iş ortaklarıyla (ör. harita,
bildirim, barındırma) yurt içi/yurt dışı düzeyde KVKK ve ilgili düzenlemelere
uygun şekilde aktarılabilir. Yurt dışı aktarımda Kanun’un ek şartları aranır.

6. Saklama süresi
İlgili mevzuat ve iş gereksinimi süresince; süre sonunda silme, yok etme veya
anonim hale getirme yapılır.

7. İlgili kişinin hakları (KVKK m.11)
Öğrenme, düzeltme, silme/yok etme, işlemenin sınırlandırılması, itiraz,
zararın giderilmesi talebi ve şikâyet hakkı (Kişisel Verileri Koruma Kurulu).

8. Başvuru
KVKK kapsamındaki taleplerinizi kimliğinizi tevsik edecek bilgi ve belgelerle
birlikte veri sorumlusunun bildirdiği kanallardan iletebilirsiniz.

İletişim (örnek): $contactEmailPlaceholder
''';

  static const String privacyPolicy = '''
1. Giriş
Bu Gizlilik Politikası, Taksim Gelsin mobil uygulamasını (“Uygulama”) kullanan
kullanıcıların kişisel verilerinin nasıl toplandığını ve kullanıldığını açıklar.
Apple App Store ve Google Play gereklilikleri ile uyumludur.

2. Toplanan veriler
• Hesap: ad, telefon; rol yolcu veya işletme tarafından onaylanmış sürücü.
• Konum: yolculuk sırasında ve talep anında işlev için konum veya adres bilgisi.
• Yolculuk kayıtları: güzergâh özeti, ücret tahmini, iptal/tamamlanma bilgisi.
• Teknik veriler: güvenli iletişim için oturum anahtarları, çökme günlükleri
(sayısal/güvenlik analizi).

3. Kullanım amaçları
Hizmet sunumu, güvenlik, destek, yasal gereklilikler ve ürün geliştirme
(anonimleştirilmiş ölçüde).

4. Çerez ve benzeri teknolojiler
Mobil ortamda oturum sürekliliği ve güvenlik için yerel depolama ve güvenli
token kullanılabilir.

5. Üçüncü taraflar
Harita, bildirim veya barındırma sağlayıcılarına yalnızca hizmetin gerektirdiği
ölçüde aktarım yapılabilir; sözleşmelerde veri güvenliği şartları aranır.

6. Güvenlik
Yetkisiz erişime karşı teknik ve idari tedbirler uygulanır; şifreler uygun
şekilde saklanır.

7. Haklarınız
KVKK ve ilgili mevzuat kapsamındaki haklarınız için veri sorumlusuna başvurabilirsiniz.

8. Çocukların gizliliği
Uygulama çocuklara yönelik değildir; bilerek 18 yaş altından veri toplanmaz.

9. Politika değişiklikleri
Önemli değişiklikler Uygulama içi bildirim veya güncelleme notu ile duyurulabilir.

İletişim: $contactEmailPlaceholder
''';

  static const String termsOfUse = '''
1. Taraflar ve konu
İşbu Koşullar, Taksim Gelsin Uygulaması üzerinden sunulan taksi çağırma ve
eşleştirme hizmetinin kullanımına ilişkindir.

2. Hizmetin niteliği
Uygulama, yolcu ile bağımsız sürücüleri bilgilendirme ve eşleştirme amacıyla
aracılık eder; taşıma sözleşmesi yolcu ile sürücü arasında doğar.

3. Hesap ve güvenlik
Kullanıcı, ilettiği bilgilerin doğru olduğunu beyan eder; şifresini gizli tutmakla
yükümlüdür. Sürücü hesabı, Uygulama üzerinden herkese açık bir kayıt formu ile
değil; veri sorumlusunun belirlediği yetkili süreçlerle açılır ve yönetilir.

4. Konum ve izinler
Yolculuk için konum ve bildirim izinleri işlevsel gereklilik içindedir; iptal
edilmesi hizmet kısıtlamasına yol açabilir.

5. Ücretlendirme
Ücretler arayüzde gösterilen tarife veya sunucu hesaplarına göre şekillenir;
ödeme yöntemi ve tahsilat müessesesi iş modelinize göre tanımlanmalıdır.

6. Yasak kullanımlar
Hile, sahte talep, sistemlere müdahale, başka kullanıcıların haklarını ihlal
eden davranışlar yasaktır; hesap askıya alınabilir veya sonlandırılabilir.

7. Sorumluluk sınırlaması
Uygulama “olduğu gibi” sunulur; mücbir sebep, üçüncü taraf altyapı kesintileri
veya trafik kaynaklı gecikmelerden doğan dolaylı zararlardan, kanunun izin
verdiği ölçüde sorumluluk sınırlıdır.

8. Fikri mülkiyet
Marka, tasarım ve yazılım unsurları koruma altındadır; izinsiz çoğaltılamaz.

9. Uygulanacak hukuk ve uyuşmazlık
Türk hukuku uygulanır; yetkili mahkemeler ve icra daireleri Türkiye Cumhuriyeti
sınırları içindedir.

10. Yürürlük
Uygulamayı kullanmaya devam etmeniz güncel koşulları kabul ettiğiniz anlamına gelir.

İletişim: $contactEmailPlaceholder
''';
}
