const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = {
  mode: "development",
  devtool: "cheap-module-source-map",
  entry: {
    background: "./src/background/index.ts",
    content: "./src/content/index.ts",
    popup: "./src/popup/index.ts",
    dashboard: "./src/dashboard/index.ts",
    interview: "./src/interview/index.ts",
    login: "./src/login/index.ts",
    "app-assist": "./src/app-assist/index.ts",
    sidepanel: "./src/sidepanel/index.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: "public", to: "." }],
    }),
    new webpack.DefinePlugin({
      "process.env.BACKEND_URL": JSON.stringify(
        process.env.BACKEND_URL || "http://127.0.0.1:8001/api/v1",
      ),
    }),
  ],
};
