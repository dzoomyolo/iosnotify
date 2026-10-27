# IOSnotify

Android читает выбранные уведомления, входящие SMS и звонки и отправляет их на ваш сервер. Сервер сразу показывает событие на сайте и шлёт Web Push на iPhone, если сайт добавлен на экран «Домой».

## Сервер и сайт

### Локально

```bash
cd server
npm install
npm start
```

Сервер слушает `0.0.0.0:8787`. В консоли будет ключ. Его нужно вписать и в Android, и в настройки сайта.

### Unraid через Docker

На старых Unraid нет `docker compose`. Используйте обычный `docker`.

1. Скопируйте папку `server` на Unraid, например в `/mnt/user/appdata/iosnotify`.
2. Узнайте сеть NPM:

```bash
docker inspect NginxProxyManager | grep -A5 Networks
```

Часто это что-то вроде `bridge` или `proxynet`. Подставьте своё имя ниже.

3. Соберите и запустите:

```bash
cd /mnt/user/appdata/iosnotify
mkdir -p data
docker build -t iosnotify .
docker run -d \
  --name iosnotify \
  --restart unless-stopped \
  -e PORT=8787 \
  -v /mnt/user/appdata/iosnotify/data:/app/data \
  --network ИМЯ_СЕТИ_NPM \
  iosnotify
```

Если сеть NPM пока неизвестна, можно сначала запустить без `--network`, а потом подключить:

```bash
docker network connect ИМЯ_СЕТИ_NPM iosnotify
```

4. Ключ в логах:

```bash
docker logs iosnotify
```

5. В NPM создайте Proxy Host:
   - Domain: `notify.ваш-домен`
   - Scheme: `http`
   - Forward Hostname: `iosnotify`
   - Forward Port: `8787`
   - включите Websockets
   - SSL: Request a new SSL Certificate
6. В Advanced добавьте:

```nginx
proxy_buffering off;
proxy_read_timeout 1h;
```

Том `data` хранит ключ, VAPID и ленту. Порт `8787` наружу не нужен, если всё через NPM.

Опционально добавьте `-e API_KEY=ваш-ключ`.

Если хотите именно compose, в Community Apps поставьте плагин **Compose Manager** или **Docker Compose**.

С телефона в той же сети откройте `http://IP-компьютера:8787` или ваш HTTPS-домен. Если Windows спросит брандмауэр, разрешите Node входящие подключения на порт 8787.

Лента обновляется сразу. Пуш на iPhone работает только по HTTPS и только у иконки с домашнего экрана (Safari, «Поделиться», «На экран Домой», затем «Включить пуш»). Домен в приложении пишите как `https://notify.example.com`, без порта. Порт 8787 подставляется только к голому IP, например `192.168.1.10`.

## Android

Нужны Node 22, **JDK 17**, Android Studio / SDK и Platform-Tools.

### Java

React Native и Gradle требуют именно **JDK 17**. Обычная Java 8 из PATH не подойдёт. JDK 21 из Android Studio (`jbr`) тоже не заменяет 17: Gradle ищет toolchain `languageVersion=17` и иначе пытается скачать JDK через foojay, что часто падает по таймауту.

Путь к JDK в git не хранится. Перед сборкой выставьте `JAVA_HOME` на JDK 17.

Если JDK лежит в `.tools/jdk-17` в корне репозитория:

```powershell
cd mobile
.\use-jdk17.ps1
```

Или вручную:

```powershell
$env:JAVA_HOME = "C:\путь\к\jdk-17"
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path
java -version
```

Должно показать `17.x`. Если видите `1.8`, Gradle упадёт с `requires JVM 17 or later`.

После смены Java лучше сбросить daemon:

```powershell
cd mobile\android
.\gradlew.bat --stop
```

`local.properties` с `sdk.dir` создаётся локально и в git не попадает. Пример:

```properties
sdk.dir=C:\\Users\\ИМЯ\\AppData\\Local\\Android\\Sdk
```

### Сборка

```powershell
cd mobile
npm install
```

Debug ждёт Metro на компьютере. Для APK «поставил и пользуюсь» собирайте release:

```powershell
cd mobile
.\use-jdk17.ps1
cd android
.\gradlew.bat assembleRelease
```

Файл: `mobile/android/app/build/outputs/apk/release/app-release.apk`.

Для разработки по USB:

```powershell
adb reverse tcp:8081 tcp:8081
cd mobile
npm start
```

В другом терминале: `npm run android`.

В приложении сначала укажите IP или адрес. «Проверить» смотрит, что хост отвечает и это IOSnotify. Поле ключа появляется только после этого. «Войти» сверяет ключ с тем же сервером. Дальше:


1. «Разрешить» для SMS, звонков и уведомлений самого приложения.
2. «Включить» у чужих уведомлений и отметить IOSnotify в системном списке.
3. Снять ограничения батареи, иначе часть событий пропадёт в фоне.
4. Отметить приложения, чьи уведомления нужно пересылать. Поиск фильтрует список.
5. «Проверить» отправляет тестовое событие. Оно должно появиться на сайте.

Пока служба работает, в шторке висит «Релей включён». SMS и звонки приходят отдельными переключателями и не зависят от списка приложений. Уведомления уходят только от отмеченных приложений. Приложение не обязано быть приложением для SMS по умолчанию. Номер звонка система отдаёт только если выдано разрешение на журнал вызовов, иначе на сайт уйдёт «Скрытый номер».

Если система остановила приложение кнопкой «Остановить», фоновые приёмники молчат, пока вы снова не откроете IOSnotify.
