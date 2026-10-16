<?php
// JSON API dla app.js:
//   GET  api.php?action=list
//   POST api.php?action=send    {text, ttl}
//   POST api.php?action=delete  {id}
//   POST api.php?action=logout
require __DIR__ . '/lib.php';

send_security_headers();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out($code, $data)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Własny nagłówek wymusza preflight CORS, więc obca strona nie wyśle tu żądania w imieniu zalogowanego.
if ($method === 'POST' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'messenger') {
    out(403, ['error' => 'Brak nagłówka X-Requested-With.']);
}

try {
    $user = current_user();
    if (!$user) {
        out(401, ['error' => 'Sesja wygasła — zaloguj się ponownie.']);
    }

    purge_expired();

    $body = [];
    if ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input') ?: '{}', true);
        if (!is_array($body)) {
            out(400, ['error' => 'Niepoprawne dane.']);
        }
    }

    if ($action === 'list' && $method === 'GET') {
        out(200, ['now' => time(), 'messages' => list_messages($user['id'])]);
    }

    if ($action === 'send' && $method === 'POST') {
        $text = trim((string)($body['text'] ?? ''));
        if ($text === '') {
            out(400, ['error' => 'Pusta wiadomość.']);
        }
        $len = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
        if ($len > MAX_TEXT) {
            out(400, ['error' => 'Wiadomość jest za długa (max ' . MAX_TEXT . ' znaków).']);
        }
        $ttl = (int)($body['ttl'] ?? 0);
        if (!in_array($ttl, cfg('ttl_options'), true)) {
            $ttl = cfg('default_ttl');
        }
        add_message($user['id'], $text, $ttl);
        out(201, ['ok' => true]);
    }

    if ($action === 'delete' && $method === 'POST') {
        delete_message($user['id'], (int)($body['id'] ?? 0));
        out(200, ['ok' => true]);
    }

    if ($action === 'logout' && $method === 'POST') {
        end_session();
        out(200, ['ok' => true]);
    }

    out(404, ['error' => 'Nieznana akcja.']);
} catch (PDOException $e) {
    error_log('messenger: ' . $e->getMessage());
    out(500, ['error' => 'Błąd bazy danych.']);
}
