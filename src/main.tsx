import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

Devvit.addCustomPostType({
  name: 'WordsGuess Game',
  height: 'tall',
  render: (context) => {
    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="wordsguess"
          url="index.html"
          onMessage={(msg) => {
            console.log('Message from webview:', msg);
          }}
        />
      </vstack>
    );
  },
});

export default Devvit;
