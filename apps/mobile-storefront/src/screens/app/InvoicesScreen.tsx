import React, {useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ChevronLeft, Download, FileText} from 'lucide-react-native';
import {showAlert} from '../../lib/dialog';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {EmptyState} from '../../components/EmptyState';
import {useAllInvoices} from '../../queries/useInvoices';
import {
  customerTaxService,
  paiseStringToINR,
  taxDocTypeLabel,
} from '../../services/customer-tax.service';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Invoices'>;

// Warm premium palette mirrors the rest of the app.
const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
  amber: '#b45309',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function InvoicesScreen() {
  const nav = useNavigation<Nav>();
  const query = useAllInvoices();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const docs = query.data?.items ?? [];

  const onDownload = async (docId: string) => {
    setDownloadingId(docId);
    try {
      const res = await customerTaxService.getDownloadUrl(docId);
      const url = res.data?.url;
      if (!url) {
        showAlert('Download failed', res.message || 'No URL returned.');
        return;
      }
      // System browser handles PDF rendering + Save/Share on both platforms.
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        showAlert('Cannot open', 'No app available to open this file.');
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      showAlert(
        'Download failed',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <View
        className="flex-row items-center px-4 py-3"
        style={{
          backgroundColor: C.surface,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}>
        <TouchableOpacity
          onPress={() => nav.goBack()}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          activeOpacity={0.7}>
          <ChevronLeft color={C.ink} size={20} />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text
            className="text-[10px] font-bold tracking-widest"
            style={{color: C.sageDeep, letterSpacing: 2}}>
            GST · TAX DOCUMENTS
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            My invoices
          </Text>
        </View>
      </View>

      {query.isLoading ? (
        <Spinner fullscreen />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load invoices"
          message="Pull down or try again."
          onRetry={() => query.refetch()}
        />
      ) : docs.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          message="Tax invoices appear here once your orders are billed."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{padding: 20, paddingBottom: 40}}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => query.refetch()}
              tintColor={C.sageDeep}
            />
          }>
          {docs.map(doc => {
            const ready = doc.status === 'PDF_GENERATED';
            const busy = downloadingId === doc.id;
            return (
              <View
                key={doc.id}
                className="rounded-2xl p-4 mb-3 flex-row items-center"
                style={{backgroundColor: C.surface}}>
                <View
                  className="w-11 h-11 rounded-xl items-center justify-center mr-3"
                  style={{backgroundColor: C.surfaceCoral}}>
                  <FileText color={C.sageDeep} size={18} />
                </View>
                <View className="flex-1 mr-2">
                  <Text
                    className="text-sm font-bold"
                    style={{color: C.ink, letterSpacing: -0.2}}
                    numberOfLines={1}>
                    {doc.documentNumber}
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.textSecondary}}>
                    {taxDocTypeLabel(doc.documentType)} ·{' '}
                    {paiseStringToINR(doc.documentTotalInPaise)}
                  </Text>
                  <Text
                    className="text-[10px] mt-0.5"
                    style={{color: C.textTertiary}}>
                    {formatDate(doc.generatedAt)}
                    {doc.financialYear ? ` · FY ${doc.financialYear}` : ''}
                  </Text>
                  {!ready ? (
                    <Text
                      className="text-[10px] mt-0.5 font-semibold"
                      style={{color: C.amber}}>
                      PDF still generating
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  className="rounded-full px-3.5 py-2 flex-row items-center"
                  style={{
                    backgroundColor: ready && !busy ? C.surfaceSage : C.surfaceWarm,
                  }}
                  disabled={!ready || busy}
                  onPress={() => onDownload(doc.id)}
                  activeOpacity={0.7}>
                  {busy ? (
                    <ActivityIndicator size="small" color={C.sageDeep} />
                  ) : (
                    <Download
                      color={ready ? C.sageDeep : C.textMuted}
                      size={14}
                    />
                  )}
                  <Text
                    className="text-[11px] font-bold ml-1.5"
                    style={{color: ready ? C.sageDeep : C.textMuted}}>
                    {busy ? 'Opening…' : ready ? 'Download' : 'Pending'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
