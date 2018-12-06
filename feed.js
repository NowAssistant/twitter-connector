'use strict';

const got = require('got');
const Autolinker = require('autolinker');

const DEFAULT_PAGE_SIZE = 5;

let action = null;
let page = null;
let pageSize = null;
let maxId = '';

module.exports = async (activity) => {
    try {
        const token = await accessToken();

        if (token) {
            const accounts = 'from%3A' + activity.Context.connector.custom2
                .replace(',', '+OR+from%3A');

            const hashtags = '%23' + activity.Context.connector.custom3
                .replace(',', '+OR+%23');

            configureRange();

            const endpoint =
                activity.Context.connector.endpoint +
                '/search/tweets.json?q=' + accounts + '+OR+' + hashtags +
                '&tweet_mode=extended&count=' + (pageSize * 2) + maxId;

            const response = await got(endpoint, {
                headers: {
                    Authorization: 'Bearer ' + token
                }
            });

            const json = JSON.parse(response.body);
            const map = new Map();

            activity.Response.Data.items = [];

            let count = 0;
            let index = 0;
            let lastItem = null;

            while (count < pageSize && index < json.statuses.length) {
                if (maxId !== '' && index === 0) {
                    index++;
                    continue;
                }

                if (pageSize - count <= json.statuses.length - count) {
                    activity.Response.Data.items.push(
                        convertItem(json.statuses[index])
                    );

                    count++;
                } else if (
                    !map.has(json.statuses[index].id_str) &&
                    !map.has(json.statuses[index].full_text)
                ) {
                    activity.Response.Data.items.push(
                        convertItem(json.statuses[index])
                    );

                    map.set(json.statuses[index].id_str, true);
                    map.set(json.statuses[index].full_text, true);

                    count++;
                }

                lastItem = json.statuses[index];

                index++;
            }

            console.log(json.statuses);
            console.log(activity.Response.Data.items);

            activity.Response.Data._action = action;
            activity.Response.Data._page = page;
            activity.Response.Data._pageSize = pageSize;
            activity.Response.Data._maxId = lastItem.id_str;
        } else {
            activity.Response.ErrorCode = 403;
            activity.Response.Data = {
                ErrorText: 'Access token not granted'
            };
        }
    } catch (error) {
        let m = error.message;

        if (error.stack) {
            m = m + ': ' + error.stack;
        }

        activity.Response.ErrorCode =
            (error.response && error.response.statusCode) || 500;

        activity.Response.Data = {
            ErrorText: m
        };
    }

    return activity; // support cloud connectors

    async function accessToken() {
        const credentials = Buffer.from(
            rfcEncode(activity.Context.connector.clientId) +
            ':' +
            rfcEncode(activity.Context.connector.custom1)
        ).toString('base64');

        const opts = {
            method: 'POST',
            headers: {
                Authorization: 'Basic ' + credentials,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: 'grant_type=client_credentials'
        };

        const response = await got('https://api.twitter.com/oauth2/token', opts);
        const json = JSON.parse(response.body);

        if (json.token_type === 'bearer') {
            return json.access_token;
        }

        return null;
    }

    function configureRange() {
        action = 'firstpage';
        page = parseInt(activity.Request.Query.page, 10) || 1;
        pageSize = parseInt(activity.Request.Query.pageSize, 10) || DEFAULT_PAGE_SIZE;

        if (
            activity.Request.Data &&
            activity.Request.Data.args &&
            activity.Request.Data.args.atAgentAction === 'nextpage'
        ) {
            action = 'nextpage';
            page = parseInt(activity.Request.Data.args._page, 10) || 2;
            pageSize =
                parseInt(activity.Request.Data.args._pageSize, 10) || DEFAULT_PAGE_SIZE;

            maxId = '&max_id=' + activity.Request.Data.args._maxId;
        }

        if (page < 1) {
            page = 1;
        }

        if (pageSize < 1 || pageSize > 99) {
            pageSize = DEFAULT_PAGE_SIZE;
        }
    }
};

function convertItem(_item) {
    const item = {
        user: {
            id: _item.user.id_str,
            screenName: _item.user.screen_name,
            name: _item.user.name,
            avatar: _item.user.profile_image_url_https
        },
        id: _item.id_str,
        favourites: _item.favorite_count,
        retweets: _item.retweet_count,
        date: new Date(_item.created_at).toISOString(),
        link: 'https://twitter.com/statuses/' + _item.id_str
    };

    if (
        _item.full_text.lastIndexOf(' https://t.co/') !== -1 &&
        _item.full_text.charAt(_item.full_text.length - 1) !== '…'
    ) {
        item.text = _item.full_text.substring(
            0, _item.full_text.lastIndexOf(' https://t.co/')
        );
    } else {
        item.text = _item.full_text;
    }

    item.text = Autolinker.link(item.text, {
        hashtag: 'twitter',
        mention: 'twitter'
    });

    if (_item.extended_entities && _item.extended_entities.media) {
        item.thumbnail = _item.extended_entities.media[0].media_url_https;
    }

    if (_item.entities.symbols && _item.entities.symbols.length > 0) {
        const regex = /\$[A-Za-z]{1,6}([._][A-Za-z]{1,2})?/g;
        const matches = _item.full_text.match(regex);

        if (matches) {
            for (let i = 0; i < matches.length; i++) {
                const enc = matches[i].replace('$', '%24');

                item.text = item.text.replace(
                    matches[i],
                    '<a href="https://twitter.com/search?q=' + enc +
                    '" target="_blank" rel="noopener noreferrer">' + matches[i] + '</a>'
                );
            }
        }
    }

    item.text = item.text.replace(
        /<a href/g,
        '<a class="blue" at-click-action="select" href'
    );

    return item;
}

function rfcEncode(key) {
    return encodeURIComponent(key)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
}
