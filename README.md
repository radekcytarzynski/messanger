# Messenger: prywatny schowek między urządzeniami

Prosty komunikator do wysyłania wiadomości samemu sobie, np. linków między dwoma komputerami.

- Dostęp tylko po zalogowaniu. Każde konto widzi wyłącznie swoje wiadomości.
- Wiadomości znikają same po 1 / 5 / 15 / 60 minutach (do wyboru przy wysyłaniu).
- Nowe wiadomości pojawiają się na innych urządzeniach po 2–3 sekundach, bez odświeżania strony.
- Do działania wystarczy zwykły hosting z PHP 7.4+ i MySQL/MariaDB. Nie ma żadnych bibliotek do instalowania.

## Instalacja

1. W panelu hostingu utwórz bazę MySQL (albo użyj istniejącej, bo tabele mają prefiks `msgr_`).
2. Skopiuj `config.sample.php` jako `config.php` i wpisz dane bazy.
3. Wgraj wszystkie pliki na serwer, np. do katalogu `public_html/msg/`.
   Strona będzie wtedy pod adresem `https://twojadomena.pl/msg/`.
   Możesz też użyć subdomeny, np. `msg.twojadomena.pl`.
4. Wejdź na ten adres. Za pierwszym razem pojawi się formularz tworzenia konta, a tabele w bazie utworzą się automatycznie.
5. Zaloguj się na obu komputerach. Sesja trwa 30 dni (`session_days` w `config.php`).

**Używaj HTTPS.** Bez niego hasło i wiadomości idą przez sieć otwartym tekstem.
Na większości hostingów certyfikat Let's Encrypt włącza się jednym kliknięciem w panelu.
Przekierowanie na HTTPS możesz też włączyć w `.htaccess`.

## Konta

Kliknij swój login w prawym górnym rogu (strona `setup.php`). Możesz tam:
- dodać konto dla bliskiej osoby,
- zmienić hasło (wpisz istniejący login). Wszystkie urządzenia tego konta zostaną wtedy wylogowane,
- usunąć konto.

## Obsługa

- **Enter** wysyła wiadomość, **Shift+Enter** wstawia nową linię.
- **Ctrl+V** w dowolnym miejscu strony wkleja tekst do pola wiadomości.
- Przycisk **Kopiuj** kopiuje wiadomość do schowka. Linki da się kliknąć.

### Obrazy

- **Ctrl+V** ze zrzutem ekranu lub skopiowanym obrazkiem, przycisk **Obraz** (plik / galeria w telefonie) albo przeciągnięcie pliku na stronę dodaje obraz. Pojawia się podgląd, a **Enter** go wysyła.
  Jeśli w schowku jest też tekst (np. komórki z Excela), wklei się tekst.
- Przy obrazie: **Kopiuj** wstawia go do schowka jako PNG (np. żeby wkleić w innym komunikatorze),
  **Udostępnij** otwiera systemowe menu udostępniania w telefonie (WhatsApp, Messenger, Signal…),
  **Pobierz** zapisuje plik.
- Kopiowanie obrazu do schowka działa tylko przez **HTTPS**. Jeśli przeglądarka go nie obsługuje, użyj „Udostępnij”.
- Formaty: PNG, JPEG, GIF, WebP. Inne (np. BMP, HEIC) oraz zbyt duże pliki przeglądarka przed wysłaniem sama przerabia na PNG/JPEG.
- Limit jednego obrazu to 8 MB (`MAX_IMAGE` w `lib.php`). Jest automatycznie obniżany do ustawień serwera: `post_max_size` w PHP i `max_allowed_packet` w MySQL.
  Na konto przypada łącznie do 64 MB obrazów (`MAX_IMAGE_TOTAL`). Po przekroczeniu najstarsze są usuwane.
- Obrazy leżą w tabeli `msgr_images` i znikają razem ze swoją wiadomością. Tabela tworzy się sama przy wejściu na stronę.
- Gdy karta jest w tle, liczba nowych wiadomości pokazuje się w tytule karty.

## Jak działa kasowanie

Każda wiadomość ma w bazie czas wygaśnięcia. Przy każdym zapytaniu do `api.php` serwer usuwa z tabeli wszystkie przeterminowane wiadomości (`DELETE`), a przeglądarka chowa je co do sekundy. Jeśli żadne urządzenie nie jest akurat otwarte, stare wiadomości zostaną skasowane przy najbliższym wejściu na stronę. Nikt nie zobaczy ich wcześniej, bo przy odczycie są i tak pomijane.

## Pliki

| Plik | Rola |
|---|---|
| `index.php` | logowanie i główna strona |
| `api.php` | JSON API: lista, wysyłanie, usuwanie, wylogowanie |
| `setup.php` | pierwsze konto oraz zarządzanie kontami |
| `lib.php` | baza, sesje, logowanie, limity prób |
| `app.js`, `setup.js`, `style.css` | interfejs |
| `config.php` | Twoje dane bazy (nie wrzucaj go do publicznego repozytorium) |

## Bezpieczeństwo

- Hasła są hashowane (`password_hash`, bcrypt).
- Sesja to losowy token w ciasteczku `HttpOnly`. W bazie trzymany jest tylko jego hash.
- Po 10 nieudanych próbach logowania z jednego IP następuje blokada na 15 minut.
- Ochrona przed CSRF: API wymaga własnego nagłówka, a formularze kont mają token.
- Nagłówki CSP, `X-Frame-Options` i `Referrer-Policy: no-referrer` sprawiają, że kliknięte linki nie zdradzają adresu messengera.
