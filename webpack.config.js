const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './background.js',
    popup: './popup.js',
    'pages/home': './pages/home.js',
    'pages/create-task': './pages/create-task.js',
    'pages/view-tasks': './pages/view-tasks.js',
    'pages/settings': './pages/settings.js',
    'pages/knowledge-base': './pages/knowledge-base.js',
    'pages/offscreen': './pages/offscreen.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js'],
    modules: [path.resolve(__dirname, 'services'), path.resolve(__dirname, 'workers'), path.resolve(__dirname, 'utils'), 'node_modules']
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'popup.html', to: 'popup.html' },
        { from: 'pages/**/*.html', to: '.' },
        { from: 'styles/**/*.css', to: '.' },
        { from: 'node_modules/pdfjs-dist/build/pdf.worker.min.js', to: 'pdf.worker.min.js', noErrorOnMissing: true },
        { from: 'node_modules/tesseract.js/dist/worker.min.js', to: 'tesseract.worker.min.js', noErrorOnMissing: true },
        { from: 'node_modules/tesseract.js-core/tesseract-core*.wasm*', to: '[name][ext]' },
        { from: 'node_modules/tesseract.js-core/tesseract-core*.js', to: '[name][ext]' },
        { from: 'icon16.png', to: 'icon16.png', noErrorOnMissing: true },
        { from: 'icon48.png', to: 'icon48.png', noErrorOnMissing: true },
        { from: 'icon128.png', to: 'icon128.png', noErrorOnMissing: true }
      ]
    })
  ]
};
