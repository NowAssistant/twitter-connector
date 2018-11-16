const got = require('got');
const Autolinker = require('autolinker');
const moment = require('moment');

module.exports = async activity => {
    try {
        const token = await access_token();

        if (token) {
            const sources = activity.Context.connector.custom3.split(',');
            const items = [];

            for (let i = 0; i < sources.length; i++) {
                const endpoint = 
                    activity.Context.connector.endpoint + 
                    '?screen_name=' + sources[i] + '&count=10';

                const response = await got(endpoint, {
                    headers: {
                        'Authorization': 'Bearer ' + token
                    }
                });

                const json = JSON.parse(response.body);

                for (let i = 0; i < json.length; i++) {
                    items.push(
                        convert_item(json[i])
                    );
                }
            }

            activity.Response.Data.items = items
                .sort(
                    function(a, b) {
                        a = new Date(a.date);
                        b = new Date(b.date);

                        return a > b 
                            ? - 1 
                            : a < b 
                                ? 1 
                                : 0;
                    })
                .splice(0, 10);

            return activity.Response.Data.items;
        } else {
            activity.Response.ErrorCode = 403;
            activity.Response.Data = {
                ErrorText: 'Access token not granted'
            };
        }
    } catch (error) {
        var m = error.message;  

        if (error.stack) {
            m = m + ': ' + error.stack;
        }

        activity.Response.ErrorCode = 
            (error.response && error.response.statusCode) || 500;

        activity.Response.Data = {
            ErrorText: m
        };
    }

    function convert_item(_item) {
        const item = {
            user: {
                id: _item.user.id,
                screen_name: _item.user.screen_name,
                name: _item.user.name
            },
            id: _item.id,
            text: Autolinker.link(_item.text, {
                hashtag: 'twitter',
                mention: 'twitter'
            }),
            favourites: _item.favorite_count,
            retweets: _item.retweet_count,
            date: new Date(_item.created_at).toISOString()
        };

        item.age = moment(item.date).fromNow(true);

        if (_item.entities.media) {
            item.thumbnail = _item.entities.media[0].media_url_https;
        }

        if (_item.entities.symbols && _item.entities.symbols.length > 0) {
            const regex = /\$[A-Za-z]{1,6}([._][A-Za-z]{1,2})?/g;
            const matches = _item.text.match(regex);

            if (matches) {
                for (let i = 0; i < matches.length; i++) {
                    const norm = matches[i].replace('$', '%24');

                    item.text = item.text.replace(
                        matches[i],
                        '<a href="https://twitter.com/search?q=' + 
                        norm + 
                        '" target="_blank" rel="noopener noreferrer">' + 
                        matches[i] + 
                        '</a>'
                    );
                }
            }
        }

        return item;
    }

    async function access_token() {
        const credentials = new Buffer.from(
            rfc_encode(activity.Context.connector.custom1) + ':' + 
            rfc_encode(activity.Context.connector.custom2)
        ).toString('base64');

        const opts = {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + credentials,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: 'grant_type=client_credentials'
        };

        const response = await got('https://api.twitter.com/oauth2/token', opts);
        const json = JSON.parse(response.body);

        if (json.token_type == 'bearer') {
            return json.access_token;
        }

        return null;
    }

    function rfc_encode(key) {
        return encodeURIComponent(key)
            .replace(/!/g, '%21')
            .replace(/'/g, '%27')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29')
            .replace(/\*/g, '%2A');
    }
};