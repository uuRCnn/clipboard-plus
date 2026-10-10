# Pano (Clipboard) Eklentisi — Plan

## Hedef
Clipboard Indicator'ın tüm özelliklerini içeren; Apple tarzı sade ve modern görünümlü;
GNOME 46–51'de çalışan (CachyOS başta olmak üzere tüm dağıtımlar); arka planda neredeyse sıfır pil
harcayan bir GNOME Shell eklentisi. Son adım: extensions.gnome.org'da yayınlamak.

## Araştırma özeti
- Referans: Clipboard Indicator v71 (GNOME 46–50, 51 resmi desteği yok).
- GNOME 51 değişiklikleri (gjs.guide):
  - `disable()` async olamaz (hata fırlatır)
  - St widget'larındaki `vertical` özelliği kaldırıldı → `orientation: Clutter.Orientation.VERTICAL`
  - `St.ButtonMask.ONE/TWO/THREE` → `PRIMARY/MIDDLE/SECONDARY`
  - `PopupMenu.open()/close()` artık `{animate, fadeOnly}` nesnesi alıyor
  - `St.ReducedMotion` → animasyonlar sistem "hareketi azalt" ayarına uyacak
  - Doğrudan `key-press-event` yerine `Clutter.KeyController` önerilir

## Özellik listesi (Clipboard Indicator'dan devralınan)
- Metin + görsel geçmişi, sabitleme (pin), arama (büyük/küçük harf, regex)
- Düzenleme, etiketleme, görsel önizleme
- Klavye kısayolları: menü aç/kapa, önceki/sonraki öğe, geçmişi temizle, gizli mod
- Menü içi tuşlar: ↑↓, Enter, Delete, v (yapıştır), p (sabitle), t (etiket), e (düzenle), h (önizle)
- Seçince otomatik yapıştır (terminal desteği: Ctrl+Shift+V / Shift+Insert)
- Gizli mod, hariç tutulan uygulamalar (şifre yöneticileri)
- Açılışta / belirli aralıklarla geçmişi temizleme, yalnızca sabitlenenleri kaydetme
- Bildirimler, boşlukları kırpma, seçilen öğeyi başa taşıma, limitler

## Ek (yeni) özellikler
- Tür algılama: bağlantı, renk kodu (#hex → renk örneği), dosya yolu, kod, görsel
- Hangi uygulamadan kopyalandığı + zaman bilgisi
- Filtre sekmeleri (Tümü / Sabitli / Görseller / Bağlantılar)
- Hassas veri algılama (şifre yöneticisi `x-kde-passwordManagerHint` ipucu → kaydetme)

## Pil / performans ilkeleri
1. **Polling yok**: yalnızca `Meta.Selection 'owner-changed'` sinyali (olay tabanlı).
2. **Tembel arayüz**: menü öğeleri yalnızca menü açılınca oluşturulur; kapalıyken hiçbir widget güncellenmez.
3. **Toplu disk yazma**: geçmiş değişikliklerinde 2 sn debounce ile tek JSON yazımı (SSD/pil dostu).
4. **Görseller**: dosya olarak saklanır, küçük önizlemeler (thumbnail) tek seferlik üretilir, hash ile tekrarlar elenir.
5. Zamanlayıcı yalnızca "aralıklı temizleme" açıksa kurulur; tek seferlik `GLib.timeout_add_seconds`.
6. Sistem "hareketi azalt" ayarına uyulur; animasyonlar kısa ve GPU dostu.

## Aşamalar
1. ✅ Araştırma + plan
2. ✅ Tasarım seçimi (PNG'ler ile): V1 varsayılan, A/B/C ayarlarda, arama ile filtreler, önizleme kartı
3. ✅ Geliştirme: extension.js, prefs.js (Adw), schemas, stylesheet (açık/koyu + vurgu rengi), çeviriler (tr, en)
4. ✅ Test: izole headless GNOME Shell 51 (`tools/run-test.sh`), ekran görüntüleri, eslint — 0 uyarı
5. ✅ Paketleme: `tools/build.sh`, README, ekran görüntüleri, GitHub deposu
6. 🚀 Yayın: extensions.gnome.org yükleme (hesap girişi kullanıcıda) — build/clipboard-plus@dukha.shell-extension.zip
