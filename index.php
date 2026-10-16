<?php
require __DIR__ . '/lib.php';

send_security_headers();
header('Cache-Control: no-store');

try {
    ensure_schema();
    if (count_users() === 0) {
        header('Location: setup.php');
        exit;
    }

    $error = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $result = attempt_login($_POST['username'] ?? '', $_POST['password'] ?? '');
        if (is_int($result)) {
            start_session($result);
            header('Location: ./');
            exit;
        }
        $error = $result;
    }

    $user = current_user();
} catch (PDOException $e) {
    error_log('messenger: ' . $e->getMessage());
    http_response_code(500);
    page_start('Messenger — błąd', 'narrow');
    echo '<main class="card"><h1>Brak połączenia z bazą</h1><p>Sprawdź dane w <code>config.php</code>.</p></main>';
    page_end();
    exit;
}

if (!$user) {
    page_start('Messenger — logowanie', 'narrow');
    ?>
<main class="card">
  <h1>Messenger</h1>
  <?php if ($error): ?><p class="error"><?= h($error) ?></p><?php endif; ?>
  <form method="post" class="stack">
    <label>Login <input name="username" required autofocus autocomplete="username" autocapitalize="none" value="<?= h($_POST['username'] ?? '') ?>"></label>
    <label>Hasło <input type="password" name="password" required autocomplete="current-password"></label>
    <button>Zaloguj</button>
  </form>
</main>
<?php
    page_end();
    exit;
}

page_start('Messenger');
?>
<header class="top">
  <h1>Messenger</h1>
  <span id="status" class="status">łączenie…</span>
  <span class="spacer"></span>
  <a class="ghost" href="setup.php" title="Konta i hasła"><?= h($user['username']) ?></a>
  <button id="logout" class="ghost" type="button">Wyloguj</button>
</header>
<main class="app">
  <form id="compose" class="compose">
    <textarea id="text" rows="3" maxlength="<?= MAX_TEXT ?>" autofocus
      placeholder="Wklej link lub wpisz wiadomość…  Enter: wyślij · Shift+Enter: nowa linia"></textarea>
    <div class="row">
      <label class="muted">Zniknie po
        <select id="ttl">
        <?php foreach (cfg('ttl_options') as $m): ?>
          <option value="<?= (int)$m ?>"<?= $m === cfg('default_ttl') ? ' selected' : '' ?>><?= (int)$m ?> min</option>
        <?php endforeach; ?>
        </select>
      </label>
      <span id="error" class="error-inline"></span>
      <button id="send" type="submit">Wyślij</button>
    </div>
  </form>
  <p id="empty" class="empty">Brak wiadomości. To, co tu wyślesz, pojawi się na Twoich pozostałych urządzeniach.</p>
  <ul id="list" class="list"></ul>
</main>
<?php
page_end('app.js');
