const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: "development",
  devtool: "cheap-module-source-map",
  entry: {
    popup: path.resolve(__dirname, "src/popup.jsx"),
    background: path.resolve(__dirname, "src/background.js"),
    content: path.resolve(__dirname, "src/content.js"),
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: { loader: "babel-loader", options: { presets: ["@babel/preset-env", "@babel/preset-react"] } },
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, "css-loader", "postcss-loader"],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|ttf|woff2?)$/i,
        type: "asset/resource",
        generator: { filename: "assets/[name][ext]" },
      },
    ],
  },
  resolve: {
    extensions: [".js", ".jsx"],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "src/popup.html"),
      filename: "popup.html",
      chunks: ["popup"],
      inject: "body",
      scriptLoading: "defer",
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "public/manifest.json", to: "manifest.json" },
        { from: "public/assets", to: "assets", noErrorOnMissing: true },
      ],
    }),
  ],
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
  },
  watchOptions: {
    ignored: /node_modules/,
  },
};
