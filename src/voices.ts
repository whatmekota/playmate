/**
 * Hand-picked Fish Audio public-library voices per language, offered as
 * one-click choices under a character's Voice field. Any other public voice
 * still works by id, link or search.
 */
export interface SuggestedVoice { id: string, title: string, note: string }

export const SUGGESTED_VOICES: Record<string, SuggestedVoice[]> = {
  en: [
    { id: 'd4ba5bc340a9470da93d263f540ab6cf', title: 'Mommy for gooners', note: 'breathy, cheerful' },
    { id: 'c2881fc9ec0b49a78b29edcb2e22b490', title: 'Mommy asmr voice', note: 'warm, expressive' },
    { id: '9780a2b12c3d492eb559dbcd8a9c62b5', title: 'Henndai', note: 'gentle, breathy' },
    { id: 'b87b9cd7c860418a8c94b180c9f54b5f', title: 'Pathetic Loser Gooner Girlfriend', note: 'raspy, fast, anime' },
    { id: '6c4940a99b11413baa7dde2cfc913fe3', title: 'Maeve Paladins ENG', note: 'energetic, character voice (mostly for laughs)' },
  ],
  ru: [
    { id: '8c3ffc55cd4d4ad1ad10eded8d063369', title: 'Юная Волшебница', note: 'high, energetic' },
    { id: 'f3952cdc0a314cb2836bc448071204a3', title: 'Аниме', note: 'high, playful' },
    { id: '8ae4142297b0462aa40f33b73bdac00b', title: 'Молодой аниме голос', note: 'high, conversational' },
    { id: 'e7f70de82a414a709fd13e983aeb2d8f', title: 'Игривый Юный Голос', note: 'playful' },
  ],
}

export const suggestedVoices = (language: string): SuggestedVoice[] => SUGGESTED_VOICES[language.slice(0, 2).toLowerCase()] ?? []
