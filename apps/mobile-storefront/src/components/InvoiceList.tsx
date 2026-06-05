import React, {useState} from 'react';
import {ActivityIndicator, Linking, Text, TouchableOpacity, View} from 'react-native';
import {showAlert} from '../lib/dialog';
import {Download, FileText} from 'lucide-react-native';
import {useInvoices} from '../queries/useInvoices';
import {
  customerTaxService,
  paiseStringToINR,
  taxDocTypeLabel,
} from '../services/customer-tax.service';

interface Props {
  orderId: string;
}

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

export function InvoiceList({orderId}: Props) {
  const query = useInvoices(orderId);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const docs = query.data?.items ?? [];

  // Hide the whole section while loading the very first time — the order
  // detail screen has enough above it; an empty placeholder would just
  // create visual noise.
  if (query.isLoading) return null;

  // Same for the empty case: don't show "no invoices" copy unless the
  // user explicitly went looking. (OrderDetail already has the order
  // summary; missing invoice is a transient state for fresh orders.)
  if (!query.isError && docs.length === 0) return null;

  const onDownload = async (docId: string) => {
    setDownloadingId(docId);
    try {
      const res = await customerTaxService.getDownloadUrl(docId);
      const url = res.data?.url;
      if (!url) {
        showAlert('Download failed', res.message || 'No URL returned.');
        return;
      }
      // System browser handles PDF rendering + Save/Share menu on both
      // platforms. We could pipe through a native viewer (e.g.
      // react-native-pdf) but that's a larger dep for marginal gain.
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
    <View className="bg-white mt-4 px-6 py-4">
      <View className="flex-row items-center mb-3">
        <FileText color="#6b7280" size={16} />
        <Text className="text-sm font-semibold text-gray-900 ml-2">
          Tax documents
        </Text>
      </View>
      {query.isError ? (
        <Text className="text-sm text-red-700">
          Couldn't load invoices. Pull down to retry.
        </Text>
      ) : (
        docs.map(doc => {
          const ready = doc.status === 'PDF_GENERATED';
          return (
            <View
              key={doc.id}
              className="flex-row items-center py-3 border-b border-gray-100 last:border-b-0">
              <View className="flex-1 mr-3">
                <Text className="text-sm font-medium text-gray-900">
                  {doc.documentNumber}
                </Text>
                <Text className="text-xs text-gray-500 mt-0.5">
                  {taxDocTypeLabel(doc.documentType)} ·{' '}
                  {paiseStringToINR(doc.documentTotalInPaise)} ·{' '}
                  {formatDate(doc.generatedAt)}
                </Text>
                {!ready ? (
                  <Text className="text-xs text-amber-700 mt-0.5">
                    PDF still generating
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                className={`flex-row items-center px-3 py-2 rounded ${
                  ready && downloadingId !== doc.id
                    ? 'bg-blue-50'
                    : 'bg-gray-100'
                }`}
                disabled={!ready || downloadingId === doc.id}
                onPress={() => onDownload(doc.id)}
                activeOpacity={0.7}>
                {downloadingId === doc.id ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : (
                  <Download
                    color={ready ? '#2563eb' : '#9ca3af'}
                    size={14}
                  />
                )}
                <Text
                  className={`text-xs font-semibold ml-1 ${
                    ready ? 'text-primary' : 'text-gray-400'
                  }`}>
                  {downloadingId === doc.id
                    ? 'Opening…'
                    : ready
                    ? 'Download'
                    : 'Pending'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </View>
  );
}
