/**
 * Initialize Learning Topics for Current User
 * 
 * This script creates initial learning topics for the currently authenticated user.
 * Run this in the browser console while logged in, or integrate into onboarding flow.
 */

import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/user-helpers';

const BEGINNER_TOPICS = [
  'What Does Finance Actually Do?',
  'Time is Money: The Power of Compounding',
  'The Big 4 Asset Classes',
  'Risk vs. Return: The Golden Rule',
  'Diversification: Don\'t Put All Eggs in One Basket',
  'Stocks 101: Owning a Piece of a Company',
  'Bonds 101: Lending Your Money',
  'Funds, ETFs & Managed Products',
  'Reading a Company\'s Report Card',
  'Inflation & Real Returns',
  'Fees & Costs: The Silent Killer',
  'Your First Portfolio: Asset Allocation Basics',
];

export async function initializeLearningTopics() {
  try {
    const userId = await getCurrentUserId();
    
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Insert all beginner topics with 0% progress
    const topics = BEGINNER_TOPICS.map(topicName => ({
      user_id: userId,
      topic_name: topicName,
      progress: 0,
      completed: false,
    }));

    const { data, error } = await supabase
      .from('learning_topics')
      .upsert(topics, {
        onConflict: 'user_id,topic_name',
        ignoreDuplicates: true,
      })
      .select();

    if (error) {
      console.error('Error initializing learning topics:', error);
      throw error;
    }

    console.log(`✅ Initialized ${data?.length || 0} learning topics`);
    return data;
  } catch (error) {
    console.error('Failed to initialize learning topics:', error);
    throw error;
  }
}

// Export for use in components
export default initializeLearningTopics;
