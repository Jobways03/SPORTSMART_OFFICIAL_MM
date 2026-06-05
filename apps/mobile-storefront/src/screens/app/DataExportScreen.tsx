import React, {useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Check,
  ChevronLeft,
  Clock,
  Download,
  FileJson,
  Info,
  Shield,
  X,
} from 'lucide-react-native';
import {
  buildDataUrl,
  dataExportService,
  downloadJsonWeb,
  MAX_DATA_URL_BYTES,
} from '../../services/data-export.service';
import {showAlert} from '../../lib/dialog';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'DataExport'>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  surfaceGold: '#fecaca',
  surfaceMauve: '#e4e4e7',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  inkSoft: '#1a1a1a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
  coral: '#fb923c',
  coralDeep: '#ea580c',
  gold: '#b91c1c',
  goldDeep: '#991b1b',
};

const INCLUDED = [
  'Profile (name, email, phone)',
  'Orders (full history)',
  'Returns + refund records',
  'Shipping addresses',
  'Wallet transactions',
  'Wishlist items',
  'Support tickets + messages',
  'Notification preferences',
  'Consent records',
];

const EXCLUDED = [
  'Internal admin notes',
  'KYC documents (request via support)',
  'Financial records we must retain by law',
];

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function DataExportScreen() {
  const nav = useNavigation<Nav>();
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const onRequest = async () => {
    setLoading(true);
    setUrl(null);
    try {
      const {jsonText, byteSize: bytes} = await dataExportService.request();
      setByteSize(bytes);
      setGeneratedAt(new Date().toISOString());

      // Web: browsers block top-level navigation to data: URLs (blank
      // tab), so save via a Blob download instead. No 2 MB cap there.
      if (Platform.OS === 'web') {
        setUrl(downloadJsonWeb(jsonText));
        return;
      }

      // Native: a data: URL opened through the system browser works, but
      // is capped at ~2 MB (platforms refuse larger data: URLs).
      if (bytes > MAX_DATA_URL_BYTES) {
        showAlert(
          'Export too large for in-app download',
          `Your data dump is ${formatBytes(
            bytes,
          )}. The mobile app supports up to ${formatBytes(
            MAX_DATA_URL_BYTES,
          )} via the system browser. Use the web version of Sportsmart for larger exports.`,
        );
        return;
      }

      const dataUrl = buildDataUrl(jsonText);
      setUrl(dataUrl);
      const supported = await Linking.canOpenURL(dataUrl);
      if (!supported) {
        showAlert(
          'Cannot open file',
          'Your device has no app to open the JSON. The dump is ready — tap "Open last export" to try again.',
        );
        return;
      }
      await Linking.openURL(dataUrl);
    } catch (err) {
      showAlert(
        'Export failed',
        err instanceof Error ? err.message : 'Try again in a minute.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{backgroundColor: C.bg}}
      edges={['top']}>
      {/* ── Header bar ───────────────────────────────────────── */}
      <View
        className="flex-row items-center px-3 py-2"
        style={{
          backgroundColor: C.bg,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}>
        <TouchableOpacity
          onPress={() => nav.goBack()}
          className="w-10 h-10 items-center justify-center rounded-full"
          activeOpacity={0.7}>
          <ChevronLeft color={C.ink} size={22} />
        </TouchableOpacity>
        <Text
          className="flex-1 font-bold ml-1"
          style={{color: C.ink, fontSize: 16, letterSpacing: -0.3}}>
          Download your data
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        {/* ── Hero — dark gradient privacy / rights surface ─── */}
        <View className="px-5 pt-4">
          <View
            style={{
              borderRadius: 28,
              overflow: 'hidden',
              shadowColor: C.sageDeep,
              shadowOpacity: 0.22,
              shadowOffset: {width: 0, height: 12},
              shadowRadius: 20,
              elevation: 10,
            }}>
            <Gradient
              colors={[C.ink, C.sageDeep]}
              angle={140}
              borderRadius={28}
              style={{minHeight: 220}}>
              <View
                className="absolute rounded-full"
                style={{
                  width: 240,
                  height: 240,
                  right: -70,
                  top: -90,
                  backgroundColor: C.sage,
                  opacity: 0.28,
                }}
              />
              <View
                className="absolute rounded-full"
                style={{
                  width: 180,
                  height: 180,
                  left: -50,
                  bottom: -70,
                  backgroundColor: C.coral,
                  opacity: 0.14,
                }}
              />
              <View className="p-6">
                <View
                  className="w-14 h-14 rounded-2xl items-center justify-center mb-4"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.16)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.28)',
                  }}>
                  <Shield color="white" size={24} />
                </View>

                <View className="flex-row mb-2">
                  <View
                    className="rounded-full px-2.5 py-1"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.28)',
                    }}>
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: 'white', letterSpacing: 0.8}}>
                      DPDP ACT · YOUR RIGHT
                    </Text>
                  </View>
                </View>

                <Text
                  className="font-black"
                  style={{
                    color: 'white',
                    fontSize: 26,
                    lineHeight: 30,
                    letterSpacing: -0.9,
                  }}>
                  Your data,{'\n'}exportable.
                </Text>
                <Text
                  className="text-xs mt-3"
                  style={{
                    color: 'rgba(255,255,255,0.78)',
                    maxWidth: '90%',
                    lineHeight: 18,
                  }}>
                  Under India's DPDP Act, you can request a copy of
                  everything we store tied to your account.
                </Text>
              </View>
            </Gradient>
          </View>
        </View>

        {/* ── What's included ──────────────────────────────── */}
        <View className="px-5 pt-5">
          <Text
            className="text-[10px] font-bold tracking-widest mb-2 px-1"
            style={{color: C.textTertiary, letterSpacing: 1.8}}>
            WHAT'S INCLUDED
          </Text>
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surface}}>
            {INCLUDED.map((item, i) => (
              <View
                key={item}
                className={`flex-row items-center ${
                  i < INCLUDED.length - 1 ? 'mb-2.5' : ''
                }`}>
                <View
                  className="w-5 h-5 rounded-full items-center justify-center mr-3"
                  style={{backgroundColor: C.sage}}>
                  <Check color="white" size={11} strokeWidth={3} />
                </View>
                <Text
                  className="text-sm flex-1"
                  style={{color: C.ink, letterSpacing: -0.1}}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── What's NOT included ──────────────────────────── */}
        <View className="px-5 pt-5">
          <Text
            className="text-[10px] font-bold tracking-widest mb-2 px-1"
            style={{color: C.textTertiary, letterSpacing: 1.8}}>
            WHAT'S NOT INCLUDED
          </Text>
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surfaceWarm}}>
            {EXCLUDED.map((item, i) => (
              <View
                key={item}
                className={`flex-row items-start ${
                  i < EXCLUDED.length - 1 ? 'mb-2.5' : ''
                }`}>
                <View
                  className="w-5 h-5 rounded-full items-center justify-center mr-3 mt-0.5"
                  style={{backgroundColor: C.gold}}>
                  <X color="white" size={11} strokeWidth={3} />
                </View>
                <Text
                  className="text-sm flex-1"
                  style={{color: C.inkSoft, lineHeight: 19}}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Rate limit info ──────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-4 flex-row items-center"
            style={{backgroundColor: C.surfaceMauve}}>
            <View
              className="w-9 h-9 rounded-xl items-center justify-center mr-3"
              style={{backgroundColor: C.surface}}>
              <Clock color={C.goldDeep} size={15} />
            </View>
            <View className="flex-1">
              <Text
                className="text-xs font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                3 requests per hour
              </Text>
              <Text
                className="text-[11px] mt-0.5"
                style={{color: C.inkSoft, lineHeight: 15}}>
                Mobile supports up to {formatBytes(MAX_DATA_URL_BYTES)}.
                Bigger exports? Use the web app.
              </Text>
            </View>
          </View>
        </View>

        {/* ── CTA ──────────────────────────────────────────── */}
        <View className="px-5 pt-5">
          {loading ? (
            <TouchableOpacity
              className="rounded-full py-4 flex-row items-center justify-center"
              style={{backgroundColor: C.textMuted}}
              disabled
              activeOpacity={1}>
              <ActivityIndicator color="white" />
            </TouchableOpacity>
          ) : (
            <View
              style={{
                borderRadius: 999,
                overflow: 'hidden',
                shadowColor: C.sageDeep,
                shadowOpacity: 0.32,
                shadowOffset: {width: 0, height: 6},
                shadowRadius: 12,
                elevation: 8,
              }}>
              <Gradient
                colors={[C.sageDeep, C.ink]}
                angle={135}
                borderRadius={999}>
                <TouchableOpacity
                  className="py-4 flex-row items-center justify-center"
                  onPress={onRequest}
                  activeOpacity={0.85}>
                  <Download color="white" size={16} />
                  <Text
                    className="text-sm font-bold text-white ml-2"
                    style={{letterSpacing: 0.3}}>
                    Generate data export
                  </Text>
                </TouchableOpacity>
              </Gradient>
            </View>
          )}

          {url ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 mt-3 flex-row items-center justify-center"
              style={{backgroundColor: C.surfaceSage}}
              onPress={() => Linking.openURL(url)}
              activeOpacity={0.7}>
              <FileJson color={C.sageDeep} size={15} />
              <Text
                className="text-sm font-bold ml-2"
                style={{color: C.sageDeep}}>
                Open last export ({formatBytes(byteSize)})
              </Text>
            </TouchableOpacity>
          ) : null}

          {generatedAt ? (
            <Text
              className="text-[11px] text-center mt-3"
              style={{color: C.textTertiary}}>
              Generated {new Date(generatedAt).toLocaleString('en-IN')}
            </Text>
          ) : null}
        </View>

        {/* ── Deletion footnote ────────────────────────────── */}
        <View className="px-5 pt-6">
          <View className="flex-row items-start">
            <Info
              color={C.textTertiary}
              size={13}
              style={{marginTop: 2, marginRight: 8}}
            />
            <Text
              className="text-[11px] flex-1"
              style={{color: C.textTertiary, lineHeight: 16}}>
              Need your data deleted? Sign out, then contact support
              via Help & support. Some records are retained by law for
              tax compliance.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
