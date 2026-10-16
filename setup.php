<?php
// Konta: przy pierwszym uruchomieniu tworzy tabele i pierwsze konto,
// później (po zalogowaniu) pozwala dodawać/usuwać konta i zmieniać hasła.
require __DIR__ . '/lib.php';

send_security_headers();

try {
    ensure_schema();
} catch (PDOException $e) {
    error_log('messenger: ' . $e->getMessage());
    http_response_code(500);
    page_start('Messenger — błąd', 'narrow');
    echo '<main class="card"><h1>Brak połączenia z bazą</h1><p>Sprawdź dane w <code>config.php</code>.</p></main>';
    page_end();
    exit;
}

$first = count_users() === 0;
$user = $first ? null : current_user();
if (!$first && !$user) {
    header('Location: ./');
    exit;
}

$error = '';
$notice = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    if (!$first && !check_csrf()) {
        $error = 'Formularz wygasł — odśwież stronę i spróbuj ponownie.';
    } elseif ($action === 'save') {
        $name = strtolower(trim((string)($_POST['username'] ?? '')));
        $p1 = (string)($_POST['password'] ?? '');
        $p2 = (string)($_POST['password2'] ?? '');
        if (!valid_username($name)) {
            $error = 'Login: 1–32 znaki, małe litery a–z, cyfry, kropka, _ lub -.';
        } elseif (strlen($p1) < 8) {
            $error = 'Hasło musi mieć co najmniej 8 znaków.';
        } elseif ($p1 !== $p2) {
            $error = 'Hasła się różnią.';
        } else {
            $db = db();
            $hash = password_hash($p1, PASSWORD_DEFAULT);
            $st = $db->prepare('SELECT id FROM ' . t('users') . ' WHERE username = ?');
            $st->execute([$name]);
            $id = $st->fetchColumn();
            if ($id === false) {
                $db->prepare('INSERT INTO ' . t('users') . ' (username, pass_hash, created) VALUES (?, ?, ?)')
                    ->execute([$name, $hash, time()]);
                $id = (int)$db->lastInsertId();
                $notice = "Dodano konto „{$name}”.";
            } else {
                $id = (int)$id;
                $db->prepare('UPDATE ' . t('users') . ' SET pass_hash = ? WHERE id = ?')->execute([$hash, $id]);
                // Zmiana hasła wylogowuje wszystkie urządzenia tego konta.
                $db->prepare('DELETE FROM ' . t('sessions') . ' WHERE user_id = ?')->execute([$id]);
                $notice = "Zmieniono hasło „{$name}” i wylogowano jego urządzenia.";
            }
            if ($first || ($user && $user['id'] === $id)) {
                start_session($id);
                header('Location: ' . ($first ? './' : 'setup.php'));
                exit;
            }
        }
    } elseif ($action === 'remove' && !$first) {
        $id = (int)($_POST['id'] ?? 0);
        if ($id === $user['id']) {
            $error = 'Nie możesz usunąć konta, na którym jesteś zalogowany.';
        } else {
            $db = db();
            $db->prepare('DELETE FROM ' . t('messages') . ' WHERE user_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM ' . t('sessions') . ' WHERE user_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM ' . t('users') . ' WHERE id = ?')->execute([$id]);
            $notice = 'Usunięto konto.';
        }
    }
}

$users = $first ? [] : db()->query('SELECT id, username FROM ' . t('users') . ' ORDER BY username')->fetchAll();

page_start('Messenger — konta', 'narrow');
?>
<main class="card">
<?php if ($first): ?>
  <h1>Pierwsze uruchomienie</h1>
  <p class="muted">Tabele w bazie są gotowe. Utwórz swoje konto.</p>
<?php else: ?>
  <p><a href="./">← wróć do wiadomości</a></p>
  <h1>Konta</h1>
<?php endif; ?>

<?php if ($error): ?><p class="error"><?= h($error) ?></p><?php endif; ?>
<?php if ($notice): ?><p class="notice"><?= h($notice) ?></p><?php endif; ?>

<?php if (!$first): ?>
  <ul class="users">
  <?php foreach ($users as $u): ?>
    <li>
      <span><?= h($u['username']) ?><?= (int)$u['id'] === $user['id'] ? ' <em class="muted">(Ty)</em>' : '' ?></span>
      <?php if ((int)$u['id'] !== $user['id']): ?>
      <form method="post" class="inline" data-confirm="Usunąć konto <?= h($u['username']) ?>?">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <input type="hidden" name="action" value="remove">
        <input type="hidden" name="id" value="<?= (int)$u['id'] ?>">
        <button class="ghost danger">Usuń</button>
      </form>
      <?php endif; ?>
    </li>
  <?php endforeach; ?>
  </ul>
  <h2>Dodaj konto lub zmień hasło</h2>
  <p class="muted">Podaj istniejący login, żeby zmienić jego hasło.</p>
<?php endif; ?>

  <form method="post" class="stack">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="action" value="save">
    <label>Login <input name="username" required maxlength="32" autocomplete="username" autocapitalize="none"></label>
    <label>Hasło <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
    <label>Powtórz hasło <input type="password" name="password2" required minlength="8" autocomplete="new-password"></label>
    <button><?= $first ? 'Utwórz konto' : 'Zapisz' ?></button>
  </form>
</main>
<?php
page_end('setup.js');
