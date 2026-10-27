# IOSnotify

Android reads selected notifications, incoming SMS, and calls, then sends them to your server. The server shows each event on the site right away and sends a Web Push to iPhone when the site is added to the Home Screen.

The current version lives in `VERSION` (now `1.1.0`). Android (`versionName`) and the server/site read it too. On release, update that file and the nearby `server/VERSION` / `package.json` values.

## Server and site

### Local

```bash
cd server
npm install
npm start
```

The server listens on `0.0.0.0:8787`. The console prints an access key. Enter it in both the Android app and the site settings.

### Unraid via Docker

Older Unraid builds do not have `docker compose`. Use plain `docker`.

1. Copy the `server` folder to Unraid, for example `/mnt/user/appdata/iosnotify`.
2. Find the NPM network:

```bash
docker inspect NginxProxyManager | grep -A5 Networks
```

It is often something like `bridge` or `proxynet`. Use that name below.

3. Build and run:

```bash
cd /mnt/user/appdata/iosnotify
mkdir -p data
docker build -t iosnotify .
docker run -d \
  --name iosnotify \
  --restart unless-stopped \
  -e PORT=8787 \
  -v /mnt/user/appdata/iosnotify/data:/app/data \
  --network NPM_NETWORK_NAME \
  iosnotify
```

If the NPM network is unknown yet, start without `--network`, then attach:

```bash
docker network connect NPM_NETWORK_NAME iosnotify
```

4. Read the key from logs:

```bash
docker logs iosnotify
```

5. In NPM create a Proxy Host:
   - Domain: `notify.your-domain`
   - Scheme: `http`
   - Forward Hostname: `iosnotify`
   - Forward Port: `8787`
   - enable Websockets
   - SSL: Request a new SSL Certificate
6. In Advanced add:

```nginx
proxy_buffering off;
proxy_read_timeout 1h;
```

The `data` volume stores the key, VAPID keys, and the event feed. You do not need to publish port `8787` if traffic goes through NPM.

Optionally add `-e API_KEY=your-key`.

If you want Compose specifically, install **Compose Manager** or **Docker Compose** from Community Apps.

From a phone on the same network open `http://COMPUTER-IP:8787` or your HTTPS domain. If Windows asks about the firewall, allow Node inbound on port 8787.

The feed updates immediately. Push on iPhone works only over HTTPS and only from the Home Screen icon (Safari → Share → Add to Home Screen → then Enable push). In the Android app use `https://notify.example.com` with no port. Port 8787 is added only for a bare IP such as `192.168.1.10`.

## Android

You need Node 22, **JDK 17**, Android Studio / SDK, and Platform-Tools.

### Java

React Native and Gradle need **JDK 17** specifically. Java 8 on PATH will not work. Android Studio JDK 21 (`jbr`) also does not replace 17: Gradle looks for toolchain `languageVersion=17` and otherwise tries to download a JDK via foojay, which often times out.

The JDK path is not stored in git. Set `JAVA_HOME` to JDK 17 before building.

If the JDK is at `.tools/jdk-17` in the repo root:

```powershell
cd mobile
.\use-jdk17.ps1
```

Or manually:

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-17"
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path
java -version
```

It should print `17.x`. If you see `1.8`, Gradle fails with `requires JVM 17 or later`.

After changing Java, stop the daemon:

```powershell
cd mobile\android
.\gradlew.bat --stop
```

`local.properties` with `sdk.dir` is created locally and is not committed. Example:

```properties
sdk.dir=C:\\Users\\NAME\\AppData\\Local\\Android\\Sdk
```

### Build

```powershell
cd mobile
npm install
```

Debug expects Metro on the computer. For a standalone APK build release:

```powershell
cd mobile
.\use-jdk17.ps1
cd android
.\gradlew.bat assembleRelease
```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`.

For USB development:

```powershell
adb reverse tcp:8081 tcp:8081
cd mobile
npm start
```

In another terminal: `npm run android`.

In the app, enter the IP or URL first. Check verifies that the host responds and is IOSnotify. The key field appears only after that. Sign in verifies the key against the same server. Then:

1. Allow SMS, calls, and the app’s own notifications.
2. Enable access to other apps’ notifications and turn on IOSnotify in the system list.
3. Disable battery restrictions, or background events may be dropped.
4. Select apps whose notifications should be forwarded. Search filters the list.
5. Send a test event. It should show up on the site.

While the relay is running, the status bar shows a keeper notification. SMS and calls have their own toggles and do not depend on the app list. Notifications are forwarded only for selected apps. The app does not need to be the default SMS app. The call number is available only if call-log permission is granted; otherwise the site shows a hidden number.

If the server is unreachable, events are stored in a local on-device queue (up to 500) and are sent automatically when the network returns, after app restart, or when you open the screen. The test button is not queued, so a dead server stays visible immediately.

If the system force-stops the app, background receivers stay silent until you open IOSnotify again.
