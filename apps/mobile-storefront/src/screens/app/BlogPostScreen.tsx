import React, {useMemo} from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {ChevronLeft} from 'lucide-react-native';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {CachedImage} from '../../components/CachedImage';
import {useBlogPost} from '../../queries/useBlog';
import {htmlToText} from '../../lib/html';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'BlogPost'>;
type Route = RouteProp<AccountStackParamList, 'BlogPost'>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  textSecondary: '#3f3f46',
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

export function BlogPostScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const query = useBlogPost(params.slug);
  const post = query.data;

  const paragraphs = useMemo(
    () => htmlToText(post?.contentHtml).split('\n').filter(Boolean),
    [post?.contentHtml],
  );

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
        <Text
          className="flex-1 ml-3 font-black"
          style={{color: C.ink, fontSize: 16, letterSpacing: -0.3}}
          numberOfLines={1}>
          {params.title ?? 'Story'}
        </Text>
      </View>

      {query.isLoading ? (
        <Spinner fullscreen />
      ) : query.isError || !post ? (
        <ErrorState title="Couldn't load this story" onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{paddingBottom: 48}} showsVerticalScrollIndicator={false}>
          {post.imageUrl ? (
            <CachedImage source={{uri: post.imageUrl}} style={{width: '100%', height: 220}} resizeMode="cover" />
          ) : null}
          <View className="px-5 pt-5">
            {post.category ? (
              <Text className="text-[10px] font-bold tracking-widest mb-2" style={{color: C.sageDeep, letterSpacing: 1.5}}>
                {post.category.toUpperCase()}
              </Text>
            ) : null}
            <Text className="font-black" style={{color: C.ink, fontSize: 24, lineHeight: 30, letterSpacing: -0.8}}>
              {post.title}
            </Text>
            <Text className="text-[11px] mt-2 mb-4" style={{color: C.textTertiary}}>
              {post.author ? `${post.author} · ` : ''}
              {formatDate(post.publishedAt)}
            </Text>
            {paragraphs.map((para, i) => (
              <Text key={i} className="text-[15px] mb-3" style={{color: C.textSecondary, lineHeight: 24}}>
                {para}
              </Text>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
