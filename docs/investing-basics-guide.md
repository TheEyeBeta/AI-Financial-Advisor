# Investing Basics Guide — Chatbot Response Design

## Problem

When a beginner asks "How do I start investing?", the chatbot dumps ~800 words
covering emergency funds, debt payoff, account types, stocks, bonds, index
funds, portfolio allocations, compound interest math, and a checklist — all in
one message. This overwhelms users and kills engagement.

## Principles for Better Chatbot Responses

### 1. One concept per message

A chatbot is not a blog. Each reply should cover **one idea** clearly, then
invite a follow-up. If a question touches three topics, pick the most
important one, answer it, and offer to cover the rest.

**Bad** (what we do now):
> Here's everything about stocks, bonds, index funds, emergency funds,
> 401(k)s, Roth IRAs, dollar-cost averaging, asset allocation, compound
> interest math, and a 7-step checklist.

**Good** (what we should do):
> The simplest way to start: put money into a low-cost index fund every month.
> An index fund owns hundreds of companies at once, so you're diversified
> instantly for a tiny fee.
>
> Want me to explain what stocks and bonds actually are, or jump straight to
> how to pick your first fund?

### 2. Keep responses under 150 words for simple questions

Beginner questions like "what is a stock?" are simple. They need 2–4
sentences, not a wall of text. Reserve longer answers for complex, multi-step
analysis where the user explicitly asks for depth.

| Question complexity | Target length   | Example                              |
|---------------------|-----------------|--------------------------------------|
| Simple definition   | 2–4 sentences   | "What is an index fund?"             |
| Moderate guidance   | 1–2 paragraphs  | "How should I start investing?"      |
| Complex analysis    | 3–5 paragraphs  | "Compare Roth vs Traditional IRA..." |

### 3. Use conversational tone, not textbook structure

Beginners are already intimidated. Don't make it worse with numbered
sub-sections and nested bullets. Write like you're explaining to a friend.

**Bad:**
```
1) First priorities (do these in order)
   1. Build an emergency fund of 3–6 months...
   2. Pay down high-interest debt...
   3. Capture employer match...
```

**Good:**
```
Before you invest anything, make sure you have a few months of
expenses saved up — that way you won't have to sell investments
in an emergency. If you have high-interest debt (like credit cards),
knock that out first. After that, you're ready to start.
```

### 4. End with a focused follow-up prompt

Don't leave the user staring at a wall of text. Give them a clear next step
or ask what they want to dig into.

**Examples:**
- "Want me to walk you through opening your first account?"
- "Should I explain the difference between stocks and bonds?"
- "Tell me your age and monthly savings — I'll suggest a starter portfolio."

### 5. Progressive disclosure over info-dumping

Spread information across multiple messages. This is a **chat**, not a
textbook chapter. Let the user pull information at their pace.

**Flow example:**
1. User: "How do I start investing?"
2. Bot: Brief answer (index funds + automate) → asks what to cover next
3. User: "What are stocks vs bonds?"
4. Bot: Brief comparison → asks if they want portfolio suggestions
5. User: "Yes"
6. Bot: Simple allocation based on their situation

## Ideal Response for "I'm new to investing, explain stocks/bonds/index funds"

Here's what the chatbot *should* say (under 120 words):

> **Stocks** = you own a tiny piece of a company. If the company grows, your
> share gets more valuable. Higher risk, higher long-term reward.
>
> **Bonds** = you lend money to a government or company. They pay you
> interest. Lower risk, lower return — acts as a stabilizer.
>
> **Index funds** = a basket that holds hundreds of stocks (or bonds) at once.
> You get instant diversification for a tiny fee. This is where most beginners
> should start.
>
> The playbook: set aside money every month into a low-cost index fund. Don't
> try to pick individual stocks yet.
>
> Want me to help you figure out how much to invest monthly, or explain what
> account to open first?

## Implementation Changes

These principles are enforced via two changes:

1. **System prompt update** (`ai_proxy.py`): Added explicit brevity rules
   for beginner-level responses — keep answers short, cover one concept per
   message, and end with a follow-up question.

2. **Suggested topic rewording** (`SuggestedTopics.tsx`): Shortened the
   beginner prompt questions so they ask about one thing at a time instead
   of requesting a full curriculum in a single message.
