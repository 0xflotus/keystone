const mongoJoinBuilder = require('../');

describe('Test main export', () => {
  test('requires a tokenizer option', () => {
    expect(() => mongoJoinBuilder()).toThrow(Error);
    expect(() => mongoJoinBuilder({})).toThrow(Error);
    expect(() => mongoJoinBuilder({ tokenizer: 'hello' })).toThrow(Error);
    expect(() => mongoJoinBuilder({ tokenizer: 10 })).toThrow(Error);

    // shouldn't throw
    mongoJoinBuilder({ tokenizer: {} });
  });

  describe('throws if tokenising function returns non-Object', () => {
    test('simple', async () => {
      const aggregate = jest.fn(() => Promise.resolve([]));

      let builder = mongoJoinBuilder({
        tokenizer: { simple: () => undefined, relationship: () => ({}) },
      });
      expect(builder({ name: 'foobar' }, aggregate)).rejects.toThrow(Error);

      builder = mongoJoinBuilder({ tokenizer: { simple: () => 10, relationship: () => ({}) } });
      expect(builder({ name: 'foobar' }, aggregate)).rejects.toThrow(Error);

      builder = mongoJoinBuilder({
        tokenizer: { simple: () => 'hello', relationship: () => ({}) },
      });
      expect(builder({ name: 'foobar' }, aggregate)).rejects.toThrow(Error);

      // Shouldn't throw
      builder = mongoJoinBuilder({ tokenizer: { simple: () => ({}), relationship: () => ({}) } });
      await builder({ name: 'foobar' }, aggregate);

      // Shouldn't throw
      builder = mongoJoinBuilder({ tokenizer: { simple: () => ({}), relationship: () => [] } });
      await builder({ name: 'foobar' }, aggregate);
    });

    test('relationship', async () => {
      const aggregate = jest.fn(() => Promise.resolve([]));

      let builder = mongoJoinBuilder({
        tokenizer: { relationship: () => undefined, simple: () => ({}) },
      });
      expect(builder({ posts: {} }, aggregate)).rejects.toThrow(Error);

      builder = mongoJoinBuilder({ tokenizer: { relationship: () => 10, simple: () => ({}) } });
      expect(builder({ posts: {} }, aggregate)).rejects.toThrow(Error);

      builder = mongoJoinBuilder({
        tokenizer: { relationship: () => 'hello', simple: () => ({}) },
      });
      expect(builder({ posts: {} }, aggregate)).rejects.toThrow(Error);

      // Shouldn't throw
      builder = mongoJoinBuilder({ tokenizer: { relationship: () => ({}), simple: () => ({}) } });
      await builder({ posts: {} }, aggregate);

      // Shouldn't throw
      builder = mongoJoinBuilder({ tokenizer: { relationship: () => ({}), simple: () => [] } });
      await builder({ posts: {} }, aggregate);
    });
  });

  test('runs the query', async () => {
    // Purposely mutate the objects down to a simple object for the lolz
    // called with (parentValue, keyOfRelationship, rootObject, path)
    const postQueryMutation = jest.fn((parentValue, key, rootObject, path) => ({
      ...parentValue,
      mutated: path.join('.'),
    }));

    const tokenizer = {
      simple: jest.fn((query, key) => [
        {
          [key]: { $eq: query[key] },
        }
      ]),
      relationship: jest.fn((query, key) => {
        const [table] = key.split('_');
        return {
          from: `${table}-collection`,
          field: table,
          postQueryMutation,
          match: { $exists: true, $ne: [] },
          many: true,
        };
      }),
    };

    const getUID = jest.fn(key => key);

    const joinQuery = {
      AND: [
        { name: 'foobar' },
        { age: 23 },
        {
          posts_every: {
            AND: [{ title: 'hello' }, { labels_some: { name: 'foo' } }],
          },
        },
      ],
    };

    const builder = mongoJoinBuilder({
      tokenizer,
      getUID,
    });

    const aggregateResponse = [
      {
        name: 'foobar',
        age: 23,
        posts: [1, 3], // the IDs are stored on the field
        posts_every_posts: [
          // this is the join result
          {
            id: 1,
            title: 'hello',
            labels: [4, 5],
            labels_some_labels: [
              {
                id: 4,
                name: 'foo',
              },
              {
                id: 5,
                name: 'foo',
              },
            ],
          },
          {
            id: 3,
            title: 'hello',
            labels: [6],
            labels_some_labels: [
              {
                id: 6,
                name: 'foo',
              },
            ],
          },
        ],
      },
    ];

    const aggregate = jest.fn(() => Promise.resolve(aggregateResponse));

    const result = await builder(joinQuery, aggregate);

    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          $and: [
            {
              $and: [
                {
                  name: {
                    $eq: 'foobar',
                  },
                },
                {
                  age: {
                    $eq: 23,
                  },
                },
              ],
            },
          ],
        },
      },
      {
        $lookup: {
          from: 'posts-collection',
          as: 'posts_every_posts',
          let: {
            posts_every_posts_ids: '$posts',
          },
          pipeline: [
            {
              $match: {
                $and: [
                  {
                    $expr: {
                      $in: ['$_id', '$$posts_every_posts_ids'],
                    },
                  },
                  {
                    title: {
                      $eq: 'hello',
                    },
                  },
                ],
              },
            },
            {
              $lookup: {
                from: 'labels-collection',
                as: 'labels_some_labels',
                let: {
                  labels_some_labels_ids: '$labels',
                },
                pipeline: [
                  {
                    $match: {
                      $and: [
                        {
                          $expr: {
                            $in: ['$_id', '$$labels_some_labels_ids'],
                          },
                        },
                        {
                          name: {
                            $eq: 'foo',
                          },
                        },
                      ],
                    },
                  },
                  {
                    $addFields: {
                      id: '$_id',
                    },
                  },
                ],
              },
            },
            {
              $addFields: {
                labels_some_labels_every: {
                  $eq: [
                    {
                      $size: '$labels_some_labels',
                    },
                    {
                      $size: '$labels',
                    },
                  ],
                },
                labels_some_labels_none: {
                  $eq: [
                    {
                      $size: '$labels_some_labels',
                    },
                    0,
                  ],
                },
                labels_some_labels_some: {
                  $and: [
                    {
                      $gt: [
                        {
                          $size: '$labels_some_labels',
                        },
                        0,
                      ],
                    },
                    {
                      $lte: [
                        {
                          $size: '$labels_some_labels',
                        },
                        {
                          $size: '$labels',
                        },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $match: {
                $and: {
                  $exists: true,
                  $ne: [],
                },
              },
            },
            {
              $addFields: {
                id: '$_id',
              },
            },
          ],
        },
      },
      {
        $addFields: {
          posts_every_posts_every: {
            $eq: [
              {
                $size: '$posts_every_posts',
              },
              {
                $size: '$posts',
              },
            ],
          },
          posts_every_posts_none: {
            $eq: [
              {
                $size: '$posts_every_posts',
              },
              0,
            ],
          },
          posts_every_posts_some: {
            $and: [
              {
                $gt: [
                  {
                    $size: '$posts_every_posts',
                  },
                  0,
                ],
              },
              {
                $lte: [
                  {
                    $size: '$posts_every_posts',
                  },
                  {
                    $size: '$posts',
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $match: {
          $and: {
            $exists: true,
            $ne: [],
          },
        },
      },
      {
        $addFields: {
          id: '$_id',
        },
      },
    ]);

    expect(result).toMatchObject([
      {
        mutated: '0',
        name: 'foobar',
        age: 23,
        posts: [1, 3],
        posts_every_posts: [
          {
            id: 1,
            mutated: '0.posts_every_posts.0',
            title: 'hello',
            labels: [4, 5],
            labels_some_labels: [
              {
                id: 4,
                name: 'foo',
              },
              {
                id: 5,
                name: 'foo',
              },
            ],
          },
          {
            mutated: '0.posts_every_posts.1',
            id: 3,
            title: 'hello',
            labels: [6],
            labels_some_labels: [
              {
                id: 6,
                name: 'foo',
              },
            ],
          },
        ],
      },
    ]);
  });
});
