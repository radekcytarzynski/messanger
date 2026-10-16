<?php
// Skopiuj ten plik jako config.php i uzupełnij dane bazy MySQL z panelu hostingu.
return [
    'db_host'      => 'localhost',
    'db_name'      => '',
    'db_user'      => '',
    'db_pass'      => '',
    'table_prefix' => 'msgr_',          // tabele: msgr_users, msgr_messages, ...

    'session_days' => 30,               // jak długo urządzenie pozostaje zalogowane
    'ttl_options'  => [1, 5, 15, 60],   // do wyboru: po ilu minutach wiadomość znika
    'default_ttl'  => 5,
];
