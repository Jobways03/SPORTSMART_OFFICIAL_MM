import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  notificationPreferencesService,
  PreferenceEntry,
  PreferencesResponse,
} from '../services/notification-preferences.service';
import {queryKeys} from './keys';

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notificationPreferences(),
    queryFn: async () => {
      const res = await notificationPreferencesService.list();
      return (
        res.data ?? {preferences: [], eventClasses: [], channels: []}
      );
    },
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: PreferenceEntry[]) =>
      notificationPreferencesService.update(entries),
    // Optimistic — toggling a switch should feel instant; rollback on
    // error keeps things honest.
    onMutate: async newEntries => {
      await qc.cancelQueries({queryKey: queryKeys.notificationPreferences()});
      const prev = qc.getQueryData<PreferencesResponse>(
        queryKeys.notificationPreferences(),
      );
      if (prev) {
        const updated = prev.preferences.map(p => {
          const override = newEntries.find(
            e => e.eventClass === p.eventClass && e.channel === p.channel,
          );
          return override ?? p;
        });
        qc.setQueryData<PreferencesResponse>(
          queryKeys.notificationPreferences(),
          {...prev, preferences: updated},
        );
      }
      return {prev};
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(queryKeys.notificationPreferences(), ctx.prev);
    },
    onSettled: () =>
      qc.invalidateQueries({queryKey: queryKeys.notificationPreferences()}),
  });
}
