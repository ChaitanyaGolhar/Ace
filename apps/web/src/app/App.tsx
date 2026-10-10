import { BrowserRouter, Route, Routes } from 'react-router';
import { SessionCompleteScreen } from '../features/complete/SessionCompleteScreen';
import { DeckScreen } from '../features/deck/DeckScreen';
import { NewDeckScreen } from '../features/deck/NewDeckScreen';
import { CardEditorScreen } from '../features/editor/CardEditorScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { ReviewScreen } from '../features/review/ReviewScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { Layout } from '../features/shell/Layout';
import { NotFound } from '../features/shell/states';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeScreen />} />
          <Route path="study" element={<ReviewScreen />} />
          <Route path="study/complete" element={<SessionCompleteScreen />} />
          <Route path="decks/new" element={<NewDeckScreen />} />
          <Route path="decks/:deckId" element={<DeckScreen />} />
          <Route path="decks/:deckId/cards/new" element={<CardEditorScreen />} />
          <Route path="cards/:cardId/edit" element={<CardEditorScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<NotFound message="Page not found." />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
