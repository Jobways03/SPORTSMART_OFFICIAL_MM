import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {profileService, UpdateProfilePayload} from '../services/profile.service';
import {queryKeys} from './keys';

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.data ?? null;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) =>
      profileService.updateProfile(payload),
    onSuccess: res => {
      // Hydrate cache immediately from the server's response so the next
      // useProfile() render doesn't show stale data while invalidate flies.
      if (res.data) qc.setQueryData(queryKeys.profile(), res.data);
      qc.invalidateQueries({queryKey: queryKeys.profile()});
    },
  });
}
