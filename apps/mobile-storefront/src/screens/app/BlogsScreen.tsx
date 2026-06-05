import React from 'react';
import {
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {ChevronLeft} from 'lucide-react-native';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {EmptyState} from '../../components/EmptyState';
import {CachedImage} from '../../components/CachedImage';
import {useBlogPosts} from '../../queries/useBlog';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Blogs'>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceCoral: '#fee2e2',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  sage: '#ef4444',
  sageDeep: '#dc2626',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function BlogsScreen() {
  const nav = useNavigation<Nav>();
  const query = useBlogPosts();
  const posts = query.data ?? [];

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <View
        className="flex-row items-center px-4 py-3"
        style={{backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border}}>
        <TouchableOpacity
          onPress={() => nav.goBack()}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          activeOpacity={0.7}>
          <ChevronLeft color={C.ink} size={20} />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text className="text-[10px] font-bold tracking-widest" style={{color: C.sageDeep, letterSpacing: 2}}>
            SPORTSMART
          </Text>
          <Text className="font-black" style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            Stories & blog
          </Text>
        </View>
      </View>

      {query.isLoading ? (
        <Spinner fullscreen />
      ) : query.isError ? (
        <ErrorState title="Couldn't load stories" onRetry={() => query.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState title="No stories yet" message="Fresh reads from the Sportsmart team will appear here." />
      ) : (
        <ScrollView
          contentContainerStyle={{padding: 20, paddingBottom: 40}}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={C.sageDeep} />
          }>
          {posts.map(post => (
            <TouchableOpacity
              key={post.id}
              className="rounded-2xl mb-4 overflow-hidden"
              style={{backgroundColor: C.surface}}
              activeOpacity={0.85}
              onPress={() => nav.navigate('BlogPost', {slug: post.slug, title: post.title})}>
              {post.imageUrl ? (
                <CachedImage
                  source={{uri: post.imageUrl}}
                  style={{width: '100%', height: 170}}
                  resizeMode="cover"
                />
              ) : null}
              <View className="p-4">
                {post.category ? (
                  <Text className="text-[10px] font-bold tracking-widest mb-1" style={{color: C.sageDeep, letterSpacing: 1.5}}>
                    {post.category.toUpperCase()}
                  </Text>
                ) : null}
                <Text className="text-base font-black" style={{color: C.ink, letterSpacing: -0.4}} numberOfLines={2}>
                  {post.title}
                </Text>
                {post.excerpt ? (
                  <Text className="text-xs mt-1.5 leading-5" style={{color: C.textSecondary}} numberOfLines={3}>
                    {post.excerpt}
                  </Text>
                ) : null}
                <Text className="text-[10px] mt-2" style={{color: C.textTertiary}}>
                  {post.author ? `${post.author} · ` : ''}
                  {formatDate(post.publishedAt)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
