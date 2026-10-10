import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { BrowseScreen } from '../features/browse/BrowseScreen';
import { DeckScreen } from '../features/deck/DeckScreen';
import { DecksScreen } from '../features/deck/DecksScreen';
import { NewDeckScreen } from '../features/deck/NewDeckScreen';
import { CardEditorScreen } from '../features/editor/CardEditorScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { ReviewScreen } from '../features/review/ReviewScreen';
import { SearchScreen } from '../features/search/SearchScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { Layout, type RouteHandle } from '../features/shell/Layout';
import { NotFound } from '../features/shell/states';
import { ToastRegion } from '../features/shell/ToastRegion';
import { UpdateBanner } from '../features/shell/UpdateBanner';
import { SignInScreen } from '../features/signin/SignInScreen';
import { StatsScreen } from '../features/stats/StatsScreen';

/** Present on every route, including the full-screen review session. */
function Root() {
  return (
    <>
      <UpdateBanner />
      <Outlet />
      <ToastRegion />
    </>
  );
}

const focused: RouteHandle = { chrome: 'focused' };

// A data router (not <BrowserRouter>) so the card editor can block navigation while
// there is unsaved text.
const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      // The review session hides all navigation.
      { path: 'study', element: <ReviewScreen /> },
      { path: 'study/complete', element: <Navigate to="/" replace /> },
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomeScreen /> },
          { path: 'decks', element: <DecksScreen /> },
          { path: 'decks/new', element: <NewDeckScreen />, handle: focused },
          { path: 'decks/:deckId', element: <DeckScreen /> },
          { path: 'decks/:deckId/cards/new', element: <CardEditorScreen />, handle: focused },
          { path: 'cards/:cardId/edit', element: <CardEditorScreen />, handle: focused },
          { path: 'browse', element: <BrowseScreen />, handle: focused },
          { path: 'stats', element: <StatsScreen /> },
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'signin', element: <SignInScreen />, handle: focused },
          { path: 'search', element: <SearchScreen /> },
          { path: '*', element: <NotFound message="Page not found." /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
