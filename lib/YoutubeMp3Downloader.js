"use strict";
var os = require('os');
var util = require('util');
var EventEmitter = require("events").EventEmitter;
var ffmpeg = require('fluent-ffmpeg');
var ytdl = require('ytdl-core');
var async = require('async');
var progress = require('progress-stream');

function YoutubeMp3Downloader(options) {

    var self = this;

    self.youtubeBaseUrl = 'http://www.youtube.com/watch?v=';
    self.youtubeVideoQuality = (options && options.youtubeVideoQuality ? options.youtubeVideoQuality : 'highest');
    self.outputPath = (options && options.outputPath ? options.outputPath : (os.platform() === 'win32' ? 'C:/Windows/Temp' : '/tmp'));
    self.queueParallelism = (options && options.queueParallelism ? options.queueParallelism : 1);
    self.progressTimeout = (options && options.progressTimeout ? options.progressTimeout : 1000);
    self.fileNameReplacements = [[/"/g, ''], [/'/g, ''], [/\//g, ''], [/\?/g, ''], [/:/g, ''], [/;/g, '']];

    if (options && options.ffmpegPath) {
        ffmpeg.setFfmpegPath(options.ffmpegPath);
    }

    //Async download/transcode queue
    self.downloadQueue = async.queue(function (task, callback) {

        self.emit("queueSize", self.downloadQueue.running() + self.downloadQueue.length());

        self.performDownload(task, function (err, result) {
            callback(err, result);
        });

    }, self.queueParallelism);

}

util.inherits(YoutubeMp3Downloader, EventEmitter);

YoutubeMp3Downloader.prototype.cleanFileName = function (fileName) {

    var self = this;

    return self.fileNameReplacements.reduce(function (acc, replacement) {
        return acc.replace(replacement[0], replacement[1])
    }, fileName);
};

YoutubeMp3Downloader.prototype.download = function (videoId, fileName) {

    var self = this;
    var task = {
        videoId: videoId,
        fileName: fileName
    };

    self.downloadQueue.push(task, function (err, data) {
        if (err) {
            self.emit("error", err);
        } else {
            self.emit('finished', data);
            self.emit("queueSize", self.downloadQueue.running() + self.downloadQueue.length());
        }
    });

};

YoutubeMp3Downloader.prototype.performDownload = function (task, cb) {

    var self = this;
    var videoUrl = self.youtubeBaseUrl + task.videoId;

    ytdl.getInfo(videoUrl, function (err, info) {

        if (err) {
            return cb(err.message, null);
        }

        var fileName = self.outputPath + '/' + task.fileName;

        ytdl.getInfo(videoUrl, { quality: self.youtubeVideoQuality }, function (err, info) {

            if (err) {
                return cb(err.message, null);
            }

            //Stream setup
            var stream = ytdl.downloadFromInfo(info, {
                quality: self.youtubeVideoQuality
            });

            stream.on("response", function (httpResponse) {

                var resultObj = {};

                //Setup of progress module
                var str = progress({
                    length: parseInt(httpResponse.headers['content-length']),
                    time: self.progressTimeout
                });

                //Add progress event listener
                str.on('progress', function (progress) {
                    if (progress.percentage === 100) {
                        resultObj.stats= {
                            transferredBytes: progress.transferred,
                            runtime: progress.runtime,
                            averageSpeed: parseFloat(progress.speed.toFixed(2))
                        }
                    }
                    self.emit("progress", {videoId: task.videoId, progress: progress})
                });

                //Start encoding
                var proc = new ffmpeg({
                    source: stream.pipe(str)
                })
                .audioBitrate(info.formats[0].audioBitrate)
                .withAudioCodec('libmp3lame')
                .toFormat('mp3')
                .outputOptions('-id3v2_version', '4')
                .on('error', function (err) {
                    cb(err.message, null);
                })
                .on('end', function () {

                    resultObj.file =  fileName;
                    resultObj.videoId = task.videoId;
                    resultObj.youtubeUrl = videoUrl;

                    cb(null, resultObj);
                })
                .saveToFile(fileName);

            });

        });

    });

};

module.exports = YoutubeMp3Downloader;
