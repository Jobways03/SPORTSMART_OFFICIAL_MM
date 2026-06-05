import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {walletService} from '../services/wallet.service';
import {queryKeys} from './keys';

export function useWalletBalance() {
  return useQuery({
    queryKey: queryKeys.wallet(),
    queryFn: async () => {
      const res = await walletService.getWallet();
      return res.data ?? {balanceInPaise: 0, currency: 'INR'};
    },
  });
}

export function useWalletTransactions() {
  return useQuery({
    queryKey: queryKeys.walletTransactions(),
    queryFn: async () => {
      const res = await walletService.listTransactions(1, 50);
      return res.data ?? {items: [], page: 1, limit: 50, total: 0};
    },
  });
}

export function useInitiateTopup() {
  return useMutation({
    mutationFn: (amountInPaise: number) =>
      walletService.initiateTopup(amountInPaise),
  });
}

export function useVerifyTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: walletService.verifyTopup,
    onSuccess: () => {
      qc.invalidateQueries({queryKey: queryKeys.wallet()});
      qc.invalidateQueries({queryKey: queryKeys.walletTransactions()});
    },
  });
}
