#!/usr/bin/env python3
"""Create / refresh po/tr.po from po/clipboard-plus.pot using the table below."""
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

TR = {
    'Opening Sound': 'Açılış Sesi',
    'Selection Sound': 'Seçim Sesi',
    'Space': 'Boşluk',
    'Esc': 'Esc',
    'Ctrl+Enter': 'Ctrl+Enter',
    'Close': 'Kapat',
    'Enlarge': 'Büyüt',
    'Open': 'Aç',
    'Open Links and Files With': 'Bağlantıları ve Dosyaları Açma Tuşu',
    'Space enlarges everything else': 'Diğer her şeyi Boşluk büyütür',
    'Show in Folder': 'Klasörde Göster',
    'Copied': 'Kopyalandı',
    'Clipboard': 'Pano',
    'Default': 'Varsayılan',
    'Calm single-line list': 'Sakin, tek satırlı liste',
    'Spotlight': 'Spotlight',
    'Source app and time': 'Kaynak uygulama ve zaman',
    'Cards': 'Kartlar',
    'Large visual previews': 'Büyük görsel önizlemeler',
    'Compact': 'Kompakt',
    'Most entries, least space': 'En az alanda en çok öğe',
    'Never': 'Asla',
    'Every 30 minutes': 'Her 30 dakikada',
    'Every hour': 'Her saat',
    'Every 6 hours': 'Her 6 saatte',
    'Every day': 'Her gün',
    'Every week': 'Her hafta',
    'Open clipboard': 'Panoyu aç',
    'Copy older entry': 'Daha eski öğeyi kopyala',
    'Copy newer entry': 'Daha yeni öğeyi kopyala',
    'Clear history': 'Geçmişi temizle',
    'Toggle Private Mode': 'Gizli Modu aç/kapat',
    'General': 'Genel',
    'Behavior': 'Davranış',
    'Paste on Select': 'Seçince Yapıştır',
    'Paste into the active window after choosing an entry': 'Bir öğe seçildiğinde etkin pencereye yapıştır',
    'Move Used Entries to Top': 'Kullanılan Öğeyi Başa Taşı',
    'Trim Whitespace': 'Boşlukları Kırp',
    'Remove spaces and line breaks around copied text': 'Kopyalanan metnin başındaki ve sonundaki boşlukları sil',
    'History Size': 'Geçmiş Boyutu',
    'Pinned entries do not count': 'Sabitlenen öğeler sayılmaz',
    'Feedback': 'Geri Bildirim',
    'Animate Panel Icon': 'Panel Simgesini Canlandır',
    'A short pulse when something is copied': 'Bir şey kopyalandığında kısa bir titreşim',
    'Animations': 'Animasyonlar',
    'Opening the popup, moving the selection and the preview card': 'Pencerenin açılışı, seçimin hareketi ve önizleme kartı',
    'Sound Effects': 'Ses Efektleri',
    'When opening the popup and choosing an entry': 'Pencereyi açarken ve bir öğe seçerken',
    'Volume': 'Ses Düzeyi',
    'Play': 'Çal',
    'Notification on Copy': 'Kopyalayınca Bildirim Göster',
    'Search': 'Ara',
    'Case Sensitive': 'Büyük/Küçük Harf Duyarlı',
    'Regular Expressions': 'Düzenli İfadeler (Regex)',
    'Appearance': 'Görünüm',
    'Layout': 'Düzen',
    'How the clipboard popup looks': 'Pano penceresinin görünümü',
    'Details': 'Ayrıntılar',
    'Show Time': 'Zamanı Göster',
    'How long ago each entry was copied': 'Her öğenin ne kadar önce kopyalandığı',
    'Preview Card': 'Önizleme Kartı',
    'A large preview of the selected entry next to the popup': 'Seçili öğenin pencerenin yanında büyük önizlemesi',
    'Show Preview Card': 'Önizleme Kartını Göster',
    'Delay with Mouse': 'Fare ile Gecikme',
    'Milliseconds': 'Milisaniye',
    'Delay with Arrow Keys': 'Ok Tuşları ile Gecikme',
    'Privacy': 'Gizlilik',
    'Private Mode': 'Gizli Mod',
    'Nothing is recorded while this is on': 'Açıkken hiçbir şey kaydedilmez',
    'Add Application': 'Uygulama Ekle',
    'Excluded Applications': 'Hariç Tutulan Uygulamalar',
    'Copies made in these apps are never recorded. Password managers are excluded by default.':
        'Bu uygulamalarda yapılan kopyalar asla kaydedilmez. Şifre yöneticileri varsayılan olarak hariçtir.',
    'Remove': 'Kaldır',
    'No excluded applications': 'Hariç tutulan uygulama yok',
    'Storage': 'Depolama',
    'Remember History': 'Geçmişi Hatırla',
    'Keep entries after logging out or restarting': 'Oturum kapatıldıktan veya yeniden başlatıldıktan sonra da sakla',
    'Remember Only Pinned Entries': 'Yalnızca Sabitlenenleri Hatırla',
    'Record Images': 'Görselleri Kaydet',
    'Largest Image': 'En Büyük Görsel',
    'Megabytes': 'Megabayt',
    'Automatic Cleanup': 'Otomatik Temizlik',
    'Pinned entries are always kept': 'Sabitlenen öğeler her zaman korunur',
    'Clear After Restart': 'Yeniden Başlatınca Temizle',
    'Clear History': 'Geçmişi Temizle',
    'Ask Before Clearing': 'Temizlemeden Önce Sor',
    'Search applications': 'Uygulama ara',
    'Shortcuts': 'Kısayollar',
    'Global Shortcuts': 'Genel Kısayollar',
    'Enable Shortcuts': 'Kısayolları Etkinleştir',
    'Disabled': 'Kapalı',
    'Inside the Popup': 'Pencere İçinde',
    'Move selection — the preview card follows': 'Seçimi taşı — önizleme kartı da takip eder',
    'Copy (and paste, if enabled)': 'Kopyala (ve açıksa yapıştır)',
    'Open link or file': 'Bağlantıyı veya dosyayı aç',
    'Type': 'Yaz',
    'Search instantly': 'Anında ara',
    'Apply the suggested filter': 'Önerilen filtreyi uygula',
    'Enlarge preview': 'Önizlemeyi büyüt',
    'Pin / unpin': 'Sabitle / sabitlemeyi kaldır',
    'Edit text': 'Metni düzenle',
    'Add a tag': 'Etiket ekle',
    'Delete entry': 'Öğeyi sil',
    'Copy entry 1–9': '1–9. öğeyi kopyala',
    'Clear search, then close': 'Aramayı temizle, sonra kapat',
    'Press a Shortcut': 'Bir Kısayola Basın',
    'Esc to cancel · Backspace to disable': 'İptal için Esc · Kapatmak için Backspace',
    'About': 'Hakkında',
    'Version %s': 'Sürüm %s',
    'Made by Dukha': 'Dukha tarafından yapıldı',
    'Website and Source Code': 'Web Sitesi ve Kaynak Kod',
    'Report a Problem': 'Sorun Bildir',
    'Battery Friendly': 'Pil Dostu',
    'Clipboard+ never polls. It only wakes up when the clipboard changes, builds its list only when you open it, and writes to disk at most once every two seconds.':
        'Clipboard+ hiçbir zaman sürekli kontrol yapmaz. Yalnızca pano değiştiğinde uyanır, listeyi yalnızca siz açtığınızda oluşturur ve diske en fazla iki saniyede bir yazar.',
    'Edit Entry': 'Öğeyi Düzenle',
    'Tag Entry': 'Öğeyi Etiketle',
    'A short label that is shown in the list and can be searched.': 'Listede görünen ve aranabilen kısa bir etiket.',
    'e.g. Work, Address, Token': 'örn. İş, Adres, Token',
    'Cancel': 'İptal',
    'Save': 'Kaydet',
    'Images': 'Görsel',
    'Links': 'Bağlantı',
    'Code': 'Kod',
    'Colors': 'Renk',
    'Pinned': 'Sabitlenenler',
    'filter\x04Pinned': 'Sabitli',
    'Files': 'Dosya',
    'Text': 'Metin',
    'Settings': 'Ayarlar',
    'Press Tab to filter by %s': '%s filtresini uygulamak için Tab',
    'History': 'Geçmiş',
    'Nothing copied yet': 'Henüz bir şey kopyalanmadı',
    'No results': 'Sonuç yok',
    'Private Mode is on — copies are not recorded': 'Gizli Mod açık — kopyalar kaydedilmiyor',
    'Copied text and images will appear here': 'Kopyaladığınız metin ve görseller burada görünür',
    'Try a different search or filter': 'Farklı bir arama veya filtre deneyin',
    'Unpin': 'Sabitlemeyi kaldır',
    'Pin': 'Sabitle',
    'Delete': 'Sil',
    'Clear clipboard history?': 'Pano geçmişi temizlensin mi?',
    'All entries except pinned ones will be deleted. This cannot be undone.':
        'Sabitlenenler dışındaki tüm öğeler silinecek. Bu işlem geri alınamaz.',
    'Clear': 'Temizle',
    'Could not open': 'Açılamadı',
    'now': 'şimdi',
    '%s ago': '%s önce',
    'Image': 'Görsel',
    'Link': 'Bağlantı',
    'yesterday': 'dün',
    'Image — %d × %d': 'Görsel — %d × %d',
    '%s and %d more': '%s ve %d tane daha',
    # plurals (Turkish has one form)
    '%d item': '%d öğe',
    '%d character': '%d karakter',
    '%d line': '%d satır',
    '%d min': '%d dk',
    '%d h': '%d sa',
    '%d day': '%d gün',
}

HEADER = '''# Turkish translation for Clipboard+.
# Copyright (C) 2026 Dukha
# This file is distributed under the same license as the Clipboard+ package.
msgid ""
msgstr ""
"Project-Id-Version: Clipboard+\\n"
"PO-Revision-Date: 2026-10-10 12:00+0300\\n"
"Last-Translator: Dukha\\n"
"Report-Msgid-Bugs-To: https://github.com/uuRCnn/clipboard-plus/issues\\n"
"Language-Team: Turkish\\n"
"Language: tr\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Plural-Forms: nplurals=1; plural=0;\\n"
'''


def unquote(lines):
    return ''.join(re.findall(r'"((?:[^"\\]|\\.)*)"', '\n'.join(lines))).encode().decode('unicode_escape').encode('latin-1').decode('utf-8')


def quote(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


pot = open(os.path.join(ROOT, 'po', 'clipboard-plus.pot'), encoding='utf-8').read()
blocks = pot.strip().split('\n\n')[1:]  # skip header
out = [HEADER]
missing = []
for block in blocks:
    lines = block.split('\n')
    comments = [ln for ln in lines if ln.startswith('#')]
    body = [ln for ln in lines if not ln.startswith('#')]
    keys = {}
    cur = None
    for ln in body:
        m = re.match(r'^(msgctxt|msgid|msgid_plural|msgstr(?:\[\d\])?) (.*)$', ln)
        if m:
            cur = m.group(1)
            keys[cur] = [m.group(2)]
        else:
            keys[cur].append(ln)
    msgid = unquote(keys['msgid'])
    ctx = unquote(keys['msgctxt']) if 'msgctxt' in keys else None
    tr = TR.get(f'{ctx}\x04{msgid}' if ctx else msgid)
    if tr is None:
        missing.append(msgid)
        tr = ''
    out.append('\n'.join(comments))
    if ctx:
        out.append(f'msgctxt {quote(ctx)}')
    out.append(f'msgid {quote(msgid)}')
    if 'msgid_plural' in keys:
        out.append(f'msgid_plural {quote(unquote(keys["msgid_plural"]))}')
        out.append(f'msgstr[0] {quote(tr)}')
    else:
        out.append(f'msgstr {quote(tr)}')
    out.append('')

open(os.path.join(ROOT, 'po', 'tr.po'), 'w', encoding='utf-8').write('\n'.join(out))
print('missing:', missing)
