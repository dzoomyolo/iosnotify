import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  PermissionsAndroid,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type { InstalledApp, PermissionState, RelaySettings } from './src/relay';
import { relay } from './src/relay';
import { hello, login, normalizeBaseUrl } from './src/server';

const emptyPerms: PermissionState = {
  sms: false,
  calls: false,
  notifications: false,
  listener: false,
  batteryIgnored: false,
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос';
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b1220" />
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const insets = useSafeAreaInsets();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [forwardNotifications, setForwardNotifications] = useState(true);
  const [forwardSms, setForwardSms] = useState(true);
  const [forwardCalls, setForwardCalls] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [perms, setPerms] = useState<PermissionState>(emptyPerms);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(relay ? 'Загрузка' : 'Модуль Relay недоступен');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifiedUrl, setVerifiedUrl] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const readyRef = useRef(false);
  const draft = useRef<RelaySettings>({
    baseUrl: '',
    apiKey: '',
    forwardNotifications: true,
    forwardSms: true,
    forwardCalls: true,
    packages: [],
  });
  const saveQueue = useRef(Promise.resolve());

  const refreshPermissions = useCallback(async () => {
    if (!relay) return;
    setPerms(await relay.getPermissionState());
  }, []);

  const commit = useCallback(async (patch: Partial<RelaySettings> = {}, announce = false) => {
    const bridge = relay;
    if (!bridge || !readyRef.current) return;
    const next: RelaySettings = { ...draft.current, ...patch };
    draft.current = next;
    const job = saveQueue.current.then(async () => {
      const snapshot: RelaySettings = {
        ...draft.current,
        packages: [...draft.current.packages],
      };
      const normalized = await bridge.saveSettings(snapshot);
      if (normalized !== draft.current.baseUrl) {
        draft.current = { ...draft.current, baseUrl: normalized };
        setBaseUrl(normalized);
      }
      bridge.startKeeper();
      if (announce) setStatus('Настройки сохранены');
    });
    saveQueue.current = job.then(
      () => undefined,
      () => undefined,
    );
    try {
      await job;
      return true;
    } catch (error) {
      setStatus(messageOf(error));
      return false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!relay) return;
      try {
        const [settings, installed, permissions] = await Promise.all([
          relay.getSettings(),
          relay.getInstalledApps(),
          relay.getPermissionState(),
        ]);
        if (!alive) return;
        draft.current = settings;
        readyRef.current = true;
        setBaseUrl(settings.baseUrl);
        setApiKey(settings.apiKey);
        setForwardNotifications(settings.forwardNotifications);
        setForwardSms(settings.forwardSms);
        setForwardCalls(settings.forwardCalls);
        setSelected(new Set(settings.packages));
        setApps(installed);
        setPerms(permissions);
        setReady(true);
        if (!settings.baseUrl) {
          setStatus('Укажите адрес сервера');
          return;
        }
        try {
          const found = await hello(settings.baseUrl);
          if (!alive) return;
          draft.current.baseUrl = found.baseUrl;
          setBaseUrl(found.baseUrl);
          setVerifiedUrl(found.baseUrl);
          setInstanceId(found.instanceId);
          if (!settings.apiKey) {
            setStatus('Сервер найден. Введите ключ');
            return;
          }
          await login(found.baseUrl, settings.apiKey, found.instanceId);
          if (!alive) return;
          setAuthorized(true);
          setStatus('Готово к отправке');
        } catch (error) {
          if (alive) setStatus(messageOf(error));
        }
      } catch (error) {
        if (alive) setStatus(messageOf(error));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshPermissions();
    });
    return () => sub.remove();
  }, [refreshPermissions]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter(
      item =>
        item.label.toLowerCase().includes(needle) ||
        item.packageName.toLowerCase().includes(needle),
    );
  }, [apps, query]);

  async function askOne(
    permission: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS],
  ) {
    const current = await PermissionsAndroid.check(permission);
    if (current) return true;
    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      setStatus('Разрешение заблокировано. Откройте настройки приложения');
      relay?.openAppSettings();
    }
    return false;
  }

  async function askSms() {
    const ok = await askOne(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
    await refreshPermissions();
    if (!ok) {
      setStatus(
        'Android запретил SMS этому приложению. Включите «Разрешить ограниченный доступ» в настройках приложения или отметьте «Сообщения» в списке ниже, SMS пойдут как уведомления',
      );
      relay?.openAppSettings();
    }
  }

  async function askCalls() {
    await askOne(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
    await askOne(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
    await refreshPermissions();
  }

  async function askNotifyPermission() {
    if (Number(Platform.Version) >= 33) {
      await askOne(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    await refreshPermissions();
    relay?.startKeeper();
  }

  function forgetServer() {
    setVerifiedUrl('');
    setInstanceId('');
    setAuthorized(false);
    setStatus('Укажите адрес сервера');
  }

  async function checkServer() {
    setBusy(true);
    try {
      const found = await hello(baseUrl);
      draft.current.baseUrl = found.baseUrl;
      setBaseUrl(found.baseUrl);
      setVerifiedUrl(found.baseUrl);
      setInstanceId(found.instanceId);
      setAuthorized(false);
      setStatus('Сервер найден. Введите ключ');
    } catch (error) {
      setVerifiedUrl('');
      setInstanceId('');
      setAuthorized(false);
      setStatus(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    if (!verifiedUrl || !instanceId) return;
    setBusy(true);
    try {
      await login(verifiedUrl, apiKey, instanceId);
      draft.current.baseUrl = verifiedUrl;
      draft.current.apiKey = apiKey.trim();
      setApiKey(apiKey.trim());
      const saved = await commit({ baseUrl: verifiedUrl, apiKey: apiKey.trim() });
      if (!saved) return;
      setAuthorized(true);
      setStatus('Вход выполнен');
    } catch (error) {
      setAuthorized(false);
      setStatus(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!relay || !ready) return;
    const saved = await commit();
    if (!saved) return;
    try {
      await relay.sendTest();
      setStatus('Тест ушёл на сервер');
    } catch (error) {
      setStatus(messageOf(error));
    }
  }

  function togglePackage(packageName: string) {
    const next = new Set(selected);
    if (next.has(packageName)) next.delete(packageName);
    else next.add(packageName);
    setSelected(next);
    commit({ packages: [...next] });
  }

  function selectShown() {
    const next = new Set(selected);
    shown.forEach(item => next.add(item.packageName));
    setSelected(next);
    commit({ packages: [...next] });
  }

  function clearSelected() {
    setSelected(new Set());
    commit({ packages: [] });
  }

  return (
    <FlatList
      data={authorized ? shown : []}
      keyExtractor={item => item.packageName}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 16,
      }}
      style={styles.screen}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>IOSnotify</Text>
          <Text style={styles.status}>{status}</Text>

          {authorized ? (
            <View style={styles.access}>
              <View style={styles.appText}>
                <Text style={styles.appLabel}>Сервер подтверждён</Text>
                <Text style={styles.appPkg}>{instanceId.slice(0, 8)}</Text>
              </View>
              <Pressable style={styles.secondary} onPress={forgetServer}>
                <Text style={styles.secondaryText}>Другой сервер</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>Адрес сервера</Text>
              <TextInput
                value={baseUrl}
                onChangeText={value => {
                  draft.current.baseUrl = value;
                  setBaseUrl(value);
                  if (verifiedUrl && normalizeBaseUrl(value) !== verifiedUrl) {
                    setVerifiedUrl('');
                    setInstanceId('');
                    setAuthorized(false);
                  }
                }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="192.168.1.10 или http://192.168.1.10:8787"
                placeholderTextColor="#66738d"
                style={styles.input}
              />
              <Text style={styles.hint}>
                IP без порта откроется как :8787. Домен указывайте с https://
              </Text>
              <Pressable
                disabled={!ready || busy}
                style={[styles.primary, styles.solo, (!ready || busy) && styles.disabled]}
                onPress={checkServer}>
                <Text style={styles.primaryText}>Проверить</Text>
              </Pressable>
              {verifiedUrl ? (
                <View>
                  <Text style={styles.label}>Ключ</Text>
                  <TextInput
                    value={apiKey}
                    onChangeText={value => {
                      draft.current.apiKey = value;
                      setApiKey(value);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Ключ из консоли сервера"
                    placeholderTextColor="#66738d"
                    style={styles.input}
                  />
                  <Pressable
                    disabled={busy}
                    style={[styles.primary, styles.solo, busy && styles.disabled]}
                    onPress={signIn}>
                    <Text style={styles.primaryText}>Войти</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}

          {authorized ? (
            <Pressable style={[styles.secondary, styles.solo]} onPress={sendTest}>
              <Text style={styles.secondaryText}>Тестовое событие</Text>
            </Pressable>
          ) : null}

          {authorized ? (
            <>
          <AccessRow
            title="SMS напрямую"
            ok={perms.sms}
            actionLabel={perms.sms ? 'Есть' : 'Разрешить'}
            onPress={askSms}
          />
          {!perms.sms ? (
            <Text style={styles.hint}>
              Если Android пишет denied access, откройте настройки IOSnotify и включите
              «Разрешить ограниченный доступ» / Allow restricted settings. Либо отметьте
              приложение «Сообщения» ниже, тогда SMS уйдут через чтение уведомлений.
            </Text>
          ) : null}
          <AccessRow
            title="Звонки"
            ok={perms.calls}
            actionLabel={perms.calls ? 'Есть' : 'Разрешить'}
            onPress={askCalls}
          />
          <AccessRow
            title="Уведомления приложения"
            ok={perms.notifications}
            actionLabel={perms.notifications ? 'Есть' : 'Разрешить'}
            onPress={askNotifyPermission}
          />
          <AccessRow
            title="Чужие уведомления"
            ok={perms.listener}
            actionLabel={perms.listener ? 'Открыто' : 'Включить'}
            onPress={() => relay?.openNotificationListenerSettings()}
          />
          <AccessRow
            title="Без ограничений батареи"
            ok={perms.batteryIgnored}
            actionLabel={perms.batteryIgnored ? 'Разрешено' : 'Открыть'}
            onPress={() => relay?.openBatterySettings()}
          />
          <AccessRow
            title="Если Allow не нажимается"
            ok={perms.sms && perms.calls && perms.notifications}
            actionLabel="Настройки"
            onPress={() => relay?.openAppSettings()}
          />

          <Toggle
            title="Уведомления выбранных приложений"
            value={forwardNotifications}
            disabled={!ready}
            onChange={value => {
              setForwardNotifications(value);
              commit({ forwardNotifications: value });
            }}
          />
          <Toggle
            title="Входящие SMS"
            value={forwardSms}
            disabled={!ready}
            onChange={value => {
              setForwardSms(value);
              commit({ forwardSms: value });
            }}
          />
          <Toggle
            title="Входящие звонки"
            value={forwardCalls}
            disabled={!ready}
            onChange={value => {
              setForwardCalls(value);
              commit({ forwardCalls: value });
            }}
          />

          <View style={styles.listHead}>
            <Text style={styles.section}>Приложения</Text>
            <Text style={styles.count}>Выбрано {selected.size}</Text>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по названию"
            placeholderTextColor="#66738d"
            style={styles.input}
          />
          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={selectShown}>
              <Text style={styles.secondaryText}>Отметить найденные</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={clearSelected}>
              <Text style={styles.secondaryText}>Очистить</Text>
            </Pressable>
          </View>
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        authorized ? (
          <Text style={styles.empty}>
            {ready ? 'Ничего не нашлось' : 'Список приложений загружается'}
          </Text>
        ) : null
      }
      renderItem={({ item }) => {
        const on = selected.has(item.packageName);
        return (
          <Pressable style={styles.appRow} onPress={() => togglePackage(item.packageName)}>
            <View style={[styles.box, on && styles.boxOn]} />
            <View style={styles.appText}>
              <Text style={styles.appLabel}>{item.label}</Text>
              <Text style={styles.appPkg}>{item.packageName}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function AccessRow({
  title,
  ok,
  actionLabel,
  onPress,
}: {
  title: string;
  ok: boolean;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.access}>
      <View style={styles.appText}>
        <Text style={styles.appLabel}>{title}</Text>
        <Text style={[styles.appPkg, ok && styles.ok]}>{ok ? 'разрешено' : 'нужен доступ'}</Text>
      </View>
      <Pressable style={styles.secondary} onPress={onPress}>
        <Text style={styles.secondaryText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function Toggle({
  title,
  value,
  disabled,
  onChange,
}: {
  title: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleText}>{title}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: '#2a3348', true: '#5b8cff' }}
        thumbColor="#f4f7ff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1220' },
  title: { color: '#e8eefc', fontSize: 28, fontWeight: '700' },
  status: { color: '#93a0bd', marginTop: 4, marginBottom: 16 },
  label: { color: '#93a0bd', marginBottom: 6, marginTop: 8 },
  hint: { color: '#66738d', marginTop: 6, marginBottom: 4 },
  input: {
    backgroundColor: '#151d2e',
    color: '#e8eefc',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8 },
  primary: {
    flex: 1,
    backgroundColor: '#5b8cff',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
  },
  primaryText: { color: '#fff', fontWeight: '700' },
  solo: { flex: 0, marginTop: 12 },
  secondary: {
    flex: 1,
    backgroundColor: '#151d2e',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  secondaryText: { color: '#e8eefc' },
  disabled: { opacity: 0.45 },
  access: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  ok: { color: '#3dd68c' },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  toggleText: { color: '#e8eefc', flex: 1 },
  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 18,
  },
  section: { color: '#e8eefc', fontSize: 18, fontWeight: '700' },
  count: { color: '#93a0bd' },
  empty: { color: '#93a0bd', paddingVertical: 20 },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#66738d',
  },
  boxOn: { backgroundColor: '#5b8cff', borderColor: '#5b8cff' },
  appText: { flex: 1 },
  appLabel: { color: '#e8eefc', fontSize: 16 },
  appPkg: { color: '#93a0bd', fontSize: 12 },
});

export default App;
