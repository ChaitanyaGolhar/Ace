import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { createDeck } from '../../services/decks';
import { UserInputError } from '../../services/errors';

export interface NewDeckViewModel {
  name: string;
  error: string | null;
  saving: boolean;
  setName: (name: string) => void;
  create: () => void;
}

export function useNewDeck(): NewDeckViewModel {
  const { ctx } = useServices();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return {
    name,
    error,
    saving,
    setName: (value) => {
      setName(value);
      setError(null);
    },
    create: () => {
      if (saving) return;
      setSaving(true);
      createDeck(ctx, name)
        .then((deck) => navigate(`/decks/${deck.id}`))
        .catch((e: unknown) => {
          setError(e instanceof UserInputError ? e.message : 'Couldn’t create the deck.');
          setSaving(false);
        });
    },
  };
}
