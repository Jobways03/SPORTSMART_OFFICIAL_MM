import {useQuery} from '@tanstack/react-query';
import {blogService} from '../services/blog.service';
import {queryKeys} from './keys';

export function useBlogPosts() {
  return useQuery({
    queryKey: queryKeys.blogPosts(),
    queryFn: async () => {
      const res = await blogService.list({limit: 30});
      return res.data?.items ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useBlogPost(slug: string) {
  return useQuery({
    queryKey: queryKeys.blogPost(slug),
    queryFn: async () => {
      const res = await blogService.getBySlug(slug);
      return res.data ?? null;
    },
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });
}
