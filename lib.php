<?php
// Wspólne funkcje: konfiguracja, baza, sesje, logowanie, wiadomości.

if (!is_file(__DIR__ . '/config.php')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Brak pliku config.php — skopiuj config.sample.php jako config.php i uzupełnij dane bazy.');
}
$CONFIG = require __DIR__ . '/config.php';

const COOKIE_NAME = 'msgr_session';
const MAX_TEXT = 20000;      // znaków w jednej wiadomości
const MAX_MESSAGES = 200;    // na konto; starsze są usuwane
const LOGIN_LIMIT = 10;      // nieudanych prób na 15 minut z jednego IP

function cfg($key)
{
    global $CONFIG;
    return $CONFIG[$key];
}

function t($name)
{
    return cfg('table_prefix') . $name;
}

function h($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function page_start($title, $bodyClass = '')
{
    ?><!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= h($title) ?></title>
<link rel="icon" href="favicon.svg">
<link rel="stylesheet" href="style.css?v=1">
</head>
<body class="<?= h($bodyClass) ?>">
<?php
}

function page_end($script = '')
{
    if ($script !== '') {
        echo '<script src="' . h($script) . '?v=1"></script>' . "\n";
    }
    echo "</body>\n</html>\n";
}

function db()
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . cfg('db_host') . ';dbname=' . cfg('db_name') . ';charset=utf8mb4';
        $pdo = new PDO($dsn, cfg('db_user'), cfg('db_pass'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

function ensure_schema()
{
    $opts = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $db = db();
    $db->exec('CREATE TABLE IF NOT EXISTS ' . t('users') . ' (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(32) NOT NULL UNIQUE,
        pass_hash VARCHAR(255) NOT NULL,
        created INT UNSIGNED NOT NULL
    ) ' . $opts);
    $db->exec('CREATE TABLE IF NOT EXISTS ' . t('sessions') . ' (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        expires INT UNSIGNED NOT NULL,
        INDEX (user_id),
        INDEX (expires)
    ) ' . $opts);
    $db->exec('CREATE TABLE IF NOT EXISTS ' . t('messages') . ' (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        body MEDIUMTEXT NOT NULL,
        created INT UNSIGNED NOT NULL,
        expires INT UNSIGNED NOT NULL,
        INDEX (user_id),
        INDEX (expires)
    ) ' . $opts);
    $db->exec('CREATE TABLE IF NOT EXISTS ' . t('login_attempts') . ' (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        created INT UNSIGNED NOT NULL,
        INDEX (ip, created)
    ) ' . $opts);
}

function send_security_headers()
{
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    // Klikane linki nie zdradzają adresu messengera.
    header('Referrer-Policy: no-referrer');
}

function is_https()
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function cookie_path()
{
    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME']));
    return rtrim($dir, '/') . '/';
}

function set_session_cookie($value, $expires)
{
    setcookie(COOKIE_NAME, $value, [
        'expires' => $expires,
        'path' => cookie_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function raw_session_token()
{
    $raw = $_COOKIE[COOKIE_NAME] ?? '';
    return (is_string($raw) && preg_match('/^[a-f0-9]{64}$/', $raw)) ? $raw : null;
}

function current_user()
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    $user = null;
    $raw = raw_session_token();
    if ($raw === null) {
        return null;
    }
    $st = db()->prepare('SELECT u.id, u.username FROM ' . t('sessions') . ' s
        JOIN ' . t('users') . ' u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires > ?');
    $st->execute([hash('sha256', $raw), time()]);
    $row = $st->fetch();
    if ($row) {
        $row['id'] = (int)$row['id'];
        $user = $row;
    }
    return $user;
}

function start_session($userId)
{
    $raw = bin2hex(random_bytes(32));
    $expires = time() + cfg('session_days') * 86400;
    db()->prepare('INSERT INTO ' . t('sessions') . ' (token_hash, user_id, expires) VALUES (?, ?, ?)')
        ->execute([hash('sha256', $raw), $userId, $expires]);
    db()->prepare('DELETE FROM ' . t('sessions') . ' WHERE expires < ?')->execute([time()]);
    set_session_cookie($raw, $expires);
}

function end_session()
{
    $raw = raw_session_token();
    if ($raw !== null) {
        db()->prepare('DELETE FROM ' . t('sessions') . ' WHERE token_hash = ?')->execute([hash('sha256', $raw)]);
    }
    set_session_cookie('', time() - 3600);
}

// Token CSRF dla formularzy — pochodna tokenu sesji, więc nie trzeba go nigdzie przechowywać.
function csrf_token()
{
    $raw = raw_session_token();
    return $raw === null ? '' : hash_hmac('sha256', 'csrf', $raw);
}

function check_csrf()
{
    $sent = $_POST['csrf'] ?? '';
    return is_string($sent) && $sent !== '' && hash_equals(csrf_token(), $sent);
}

function count_users()
{
    return (int)db()->query('SELECT COUNT(*) FROM ' . t('users'))->fetchColumn();
}

function valid_username($name)
{
    return is_string($name) && preg_match('/^[a-z0-9._-]{1,32}$/', $name);
}

function client_ip()
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45);
}

// Zwraca id użytkownika albo komunikat błędu (string).
function attempt_login($username, $password)
{
    $ip = client_ip();
    $db = db();
    $db->prepare('DELETE FROM ' . t('login_attempts') . ' WHERE created < ?')->execute([time() - 900]);
    $st = $db->prepare('SELECT COUNT(*) FROM ' . t('login_attempts') . ' WHERE ip = ?');
    $st->execute([$ip]);
    if ((int)$st->fetchColumn() >= LOGIN_LIMIT) {
        return 'Za dużo nieudanych prób. Spróbuj ponownie za kilkanaście minut.';
    }

    $username = strtolower(trim((string)$username));
    $st = $db->prepare('SELECT id, pass_hash FROM ' . t('users') . ' WHERE username = ?');
    $st->execute([$username]);
    $row = $st->fetch();
    // Przy nieistniejącym koncie i tak liczymy hash, żeby czas odpowiedzi nie zdradzał loginów.
    $hash = $row ? $row['pass_hash'] : password_hash('dummy', PASSWORD_DEFAULT);
    if (password_verify((string)$password, $hash) && $row) {
        return (int)$row['id'];
    }
    $db->prepare('INSERT INTO ' . t('login_attempts') . ' (ip, created) VALUES (?, ?)')->execute([$ip, time()]);
    return 'Błędny login lub hasło.';
}

function purge_expired()
{
    db()->prepare('DELETE FROM ' . t('messages') . ' WHERE expires <= ?')->execute([time()]);
}

function list_messages($userId)
{
    $st = db()->prepare('SELECT id, body, created, expires FROM ' . t('messages') . '
        WHERE user_id = ? AND expires > ? ORDER BY id');
    $st->execute([$userId, time()]);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $out[] = [
            'id' => (int)$r['id'],
            'text' => $r['body'],
            'created' => (int)$r['created'],
            'expires' => (int)$r['expires'],
        ];
    }
    return $out;
}

function add_message($userId, $text, $ttlMinutes)
{
    $now = time();
    $db = db();
    $db->prepare('INSERT INTO ' . t('messages') . ' (user_id, body, created, expires) VALUES (?, ?, ?, ?)')
        ->execute([$userId, $text, $now, $now + $ttlMinutes * 60]);
    // Limit liczby wiadomości na konto.
    $st = $db->prepare('SELECT id FROM ' . t('messages') . ' WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ' . MAX_MESSAGES);
    $st->execute([$userId]);
    $cut = $st->fetchColumn();
    if ($cut !== false) {
        $db->prepare('DELETE FROM ' . t('messages') . ' WHERE user_id = ? AND id <= ?')->execute([$userId, (int)$cut]);
    }
}

function delete_message($userId, $id)
{
    db()->prepare('DELETE FROM ' . t('messages') . ' WHERE user_id = ? AND id = ?')->execute([$userId, $id]);
}
